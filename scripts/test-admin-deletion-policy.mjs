import assert from "node:assert/strict";
import {
  adminDeletionQueuePayloads,
  canQueueAdminDeletion,
  isProtectedAdministrator,
  normalizeUsername
} from "../admin-deletion-policy.mjs";

assert.equal(normalizeUsername("  I_Love_You_H  "), "i_love_you_h");
assert.equal(normalizeUsername("\tOwnerCyberCapone\n"), "ownercybercapone");
assert.equal(normalizeUsername(null), "");
assert.equal(isProtectedAdministrator(" i_love_you_h "), true);
assert.equal(isProtectedAdministrator("OWNERCYBERCAPONE"), true);
assert.equal(isProtectedAdministrator("ordinary_user"), false);

assert.equal(canQueueAdminDeletion({ targetUid: "ordinary", username: "ordinary_user", existingJob: false, existingQueueState: false }), true);
assert.equal(canQueueAdminDeletion({ targetUid: "", username: "ordinary_user", existingJob: false, existingQueueState: false }), false);
assert.equal(canQueueAdminDeletion({ targetUid: "owner", username: "ownerCyberCapone", existingJob: false, existingQueueState: false }), false);
assert.equal(canQueueAdminDeletion({ targetUid: "ordinary", username: "ordinary_user", existingJob: true, existingQueueState: false }), false);
assert.equal(canQueueAdminDeletion({ targetUid: "ordinary", username: "ordinary_user", existingJob: false, existingQueueState: true }), false);

const timestamp = { sentinel: "serverTimestamp" };
assert.deepEqual(
  adminDeletionQueuePayloads({ targetUid: "ordinary", requesterUid: "admin", timestamp }),
  {
    profile: {
      banned: true,
      adminDeletionRequestedAt: timestamp,
      adminDeletionRequestedBy: "admin",
      adminDeletionStatus: "queued"
    },
    job: {
      targetUid: "ordinary",
      requesterUid: "admin",
      requestedAt: timestamp,
      status: "queued"
    }
  }
);

assert.throws(() => adminDeletionQueuePayloads({ targetUid: "", requesterUid: "admin", timestamp }));
assert.throws(() => adminDeletionQueuePayloads({ targetUid: "ordinary", requesterUid: "", timestamp }));
assert.throws(() => adminDeletionQueuePayloads({ targetUid: "ordinary", requesterUid: "admin" }));

console.log("Administrator deletion policy passed");
