import assert from "node:assert/strict";
import {
  adminDeletionQueuePayloads,
  canAdminSetBanned,
  canQueueAdminDeletion,
  hasAdminDeletionQueueState,
  isProtectedAdministrator,
  normalizeUsername
} from "../admin-deletion-policy.mjs";

assert.equal(normalizeUsername("  I_Love_You_H  "), "i_love_you_h");
assert.equal(normalizeUsername("\tOwnerCyberCapone\n"), "ownercybercapone");
assert.equal(normalizeUsername("\u00a0I_LOVE_YOU_H\u00a0"), "i_love_you_h");
assert.equal(normalizeUsername("\uFEFFOwnerCyberCapone\uFEFF"), "ownercybercapone");
assert.equal(normalizeUsername(null), "");
assert.equal(isProtectedAdministrator(" i_love_you_h "), true);
assert.equal(isProtectedAdministrator("OWNERCYBERCAPONE"), true);
assert.equal(isProtectedAdministrator("\u00a0i_love_you_h\u00a0"), true);
assert.equal(isProtectedAdministrator("\uFEFFownercybercapone\uFEFF"), true);
assert.equal(isProtectedAdministrator("ordinary_user"), false);

assert.equal(canQueueAdminDeletion({ targetUid: "ordinary", username: "ordinary_user", existingJob: false, existingQueueState: false }), true);
assert.equal(canQueueAdminDeletion({ targetUid: "", username: "ordinary_user", existingJob: false, existingQueueState: false }), false);
assert.equal(canQueueAdminDeletion({ targetUid: "owner", username: "ownerCyberCapone", existingJob: false, existingQueueState: false }), false);
assert.equal(canQueueAdminDeletion({ targetUid: "ordinary", username: "ordinary_user", existingJob: true, existingQueueState: false }), false);
assert.equal(canQueueAdminDeletion({ targetUid: "ordinary", username: "ordinary_user", existingJob: false, existingQueueState: true }), false);
assert.equal(hasAdminDeletionQueueState({ adminDeletionStatus: "queued" }), true);
assert.equal(hasAdminDeletionQueueState({}), false);
assert.equal(canAdminSetBanned({ nextBanned: true, existingJob: true, existingQueueState: true }), true);
assert.equal(canAdminSetBanned({ nextBanned: false, existingJob: true, existingQueueState: true }), false);
assert.equal(canAdminSetBanned({ nextBanned: false, existingJob: false, existingQueueState: false }), true);

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
