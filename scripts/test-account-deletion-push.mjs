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
    createDeletionRequest: async () => events.push("deletion-request-created")
  });
  assert.deepEqual(events, [
    "listed:user-a",
    "documents-deleted",
    "browser-unsubscribed",
    "deletion-request-created"
  ], "every subscription and the browser endpoint are removed while the profile is active and before the deletion barrier");
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
    createDeletionRequest: async () => events.push("deletion-request-created")
  });

  await assert.rejects(operation(), /batch rejected/);
  assert.deepEqual(events, ["listed", "delete-attempt-1", "browser-unsubscribed"], "a failed document cleanup does not create the deletion barrier but still removes the browser subscription");
  await assert.doesNotReject(operation());
  assert.deepEqual(events.slice(-4), ["listed", "delete-attempt-2", "browser-unsubscribed", "deletion-request-created"], "the same deletion flow can be retried safely");
}

{
  const events = [];
  await assert.rejects(preparePushForAccountDeletion({
    uid: "user-a",
    listSubscriptionRefs: async () => [],
    deleteSubscriptionRefs: async () => events.push("documents-deleted"),
    unsubscribeCurrent: async () => { events.push("unsubscribe-failed"); throw new Error("unsubscribe failed"); },
    createDeletionRequest: async () => events.push("deletion-request-created")
  }), /unsubscribe failed/);
  assert.deepEqual(events, ["documents-deleted", "unsubscribe-failed"], "a failed browser unsubscribe leaves the account active for retry");
}

console.log("Self-deletion push cleanup passed");
