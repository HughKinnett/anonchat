import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { preparePushForAccountDeletion, selfDeletionQueuePayloads } from "../account-deletion-push.mjs";

const timestamp = { sentinel: "server-time" };
assert.deepEqual(selfDeletionQueuePayloads({ uid: "user-a", username: "User_A", timestamp }), {
  request: { uid: "user-a", username: "User_A", createdAt: timestamp },
  job: { targetUid: "user-a", requesterUid: "user-a", requestedAt: timestamp, requestType: "self", status: "queued" }
});
assert.throws(() => selfDeletionQueuePayloads({ uid: "", username: "User_A", timestamp }), /account/);
const clientSource = await readFile(new URL("../delete-account.js", import.meta.url), "utf8");
assert.doesNotMatch(clientSource, /collectionGroup|\bdeleteUser\s*\(|gatherOwnedData/, "the public page cannot enumerate or directly delete account data/Auth");
assert.match(clientSource, /batch\.set\(requestRef,payloads\.request\);batch\.set\(jobRef,payloads\.job\)/, "self deletion atomically establishes both trusted queue records");
assert.match(clientSource, /requestSnapshot\.exists\(\)&&!jobSnapshot\.exists\(\)/, "a stranded legacy request takes the job-only repair path");
assert.match(clientSource, /Account locked\. Permanent deletion is queued/);

{
  const events = [];
  const refs = [{ path: "pushSubscriptions/a" }, { path: "pushSubscriptions/b" }];
  await preparePushForAccountDeletion({
    uid: "user-a",
    listSubscriptionRefs: async (uid) => { events.push(`listed:${uid}`); return refs; },
    deleteSubscriptionRefs: async (received) => { assert.equal(received, refs); events.push("documents-deleted"); },
    unsubscribeCurrent: async () => events.push("browser-unsubscribed"),
    ensureDeletionRequest: async () => events.push("deletion-barrier-ensured")
  });
  assert.deepEqual(events, [
    "deletion-barrier-ensured",
    "listed:user-a",
    "documents-deleted",
    "browser-unsubscribed"
  ], "the deletion barrier is durable before any device subscription cleanup begins");
}

{
  const events = [];
  let deletionAttempt = 0;
  const operation = () => preparePushForAccountDeletion({
    uid: "user-a",
    listSubscriptionRefs: async () => { events.push("listed"); return [{ path: "pushSubscriptions/a" }]; },
    deleteSubscriptionRefs: async () => {
      deletionAttempt += 1;
      events.push(`delete-attempt-${deletionAttempt}`);
      if (deletionAttempt === 1) throw new Error("batch rejected");
    },
    unsubscribeCurrent: async () => events.push("browser-unsubscribed"),
    ensureDeletionRequest: async () => events.push("deletion-barrier-ensured")
  });

  await assert.rejects(operation(), /batch rejected/);
  assert.deepEqual(events, ["deletion-barrier-ensured", "listed", "delete-attempt-1", "browser-unsubscribed"], "a failed document cleanup leaves the barrier in place and still removes the browser subscription");
  await assert.doesNotReject(operation());
  assert.deepEqual(events.slice(-4), ["deletion-barrier-ensured", "listed", "delete-attempt-2", "browser-unsubscribed"], "retry resumes cleanup behind the existing barrier");
}

{
  const events = [];
  await assert.rejects(preparePushForAccountDeletion({
    uid: "user-a",
    listSubscriptionRefs: async () => [],
    deleteSubscriptionRefs: async () => events.push("documents-deleted"),
    unsubscribeCurrent: async () => { events.push("unsubscribe-failed"); throw new Error("unsubscribe failed"); },
    ensureDeletionRequest: async () => events.push("deletion-barrier-ensured")
  }), /unsubscribe failed/);
  assert.deepEqual(events, ["deletion-barrier-ensured", "documents-deleted", "unsubscribe-failed"], "a failed browser unsubscribe leaves the deletion barrier in place for retry");
}

console.log("Self-deletion push cleanup passed");
