import assert from "node:assert/strict";
import { preparePushForAccountDeletion } from "../account-deletion-push.mjs";

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
