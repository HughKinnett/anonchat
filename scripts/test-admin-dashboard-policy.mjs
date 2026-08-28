import assert from "node:assert/strict";
import {
  canConfirmDeletion,
  deletionJobRecord,
  deletionDialogJobTransition,
  filterUsers,
  processorHealth,
  queueFailureDialogTransition,
  resolveUserFocus,
  statusForUser,
  sortInactiveUsers
} from "../admin-dashboard-policy.mjs";

const now = Date.UTC(2026, 7, 28, 12, 0, 0);
const day = 24 * 60 * 60 * 1000;
const user = (id, username, lastActiveAt, extra = {}) => ({ id, username, lastActiveAt, ...extra });

// A wrong cutoff comparator, malformed-date coercion, or status ordering must fail these tests.
assert.equal(statusForUser(user("equal", "equal", now - 7 * day), { now }).kind, "inactive");
assert.equal(statusForUser(user("recent", "recent", now - 7 * day + 1), { now }).kind, "active");
assert.equal(statusForUser(user("unknown", "unknown", "yesterday"), { now }).kind, "activity-not-recorded");
assert.equal(statusForUser(user("banned", "banned", "bad", { banned: true }), { now }).kind, "banned");
assert.equal(statusForUser(user("queued", "queued", "bad", { banned: true }), { now, deletionJobs: new Map([["queued", { status: "failed" }]]) }).kind, "deletion-pending");

const users = [
  user("active", "alpha", now - day),
  user("inactive-newer", "bravo", now - 8 * day),
  user("inactive-older", "charlie", now - 20 * day),
  user("banned", "delta", now - 20 * day, { banned: true }),
  user("pending", "echo", now - 20 * day),
  user("unknown", "foxtrot", null)
];
const jobs = new Map([["pending", { status: "queued" }]]);
assert.deepEqual(filterUsers(users, { filter: "inactive", now, deletionJobs: jobs }).map(({ id }) => id), ["inactive-newer", "inactive-older"]);
assert.deepEqual(sortInactiveUsers(users, { now, deletionJobs: jobs }).map(({ id }) => id), ["inactive-older", "inactive-newer"]);
assert.deepEqual(filterUsers(users, { filter: "deletion-pending", now, deletionJobs: jobs }).map(({ id }) => id), ["pending"]);
assert.deepEqual(filterUsers(users, { filter: "activity-not-recorded", now, deletionJobs: jobs }).map(({ id }) => id), ["unknown"]);

assert.equal(canConfirmDeletion({ typedUsername: "Target", targetUsername: "Target", blocked: false }), true);
assert.equal(canConfirmDeletion({ typedUsername: "target", targetUsername: "Target", blocked: false }), false);
assert.equal(canConfirmDeletion({ typedUsername: "Target ", targetUsername: "Target", blocked: false }), false);
assert.equal(canConfirmDeletion({ typedUsername: "Target", targetUsername: "Target", blocked: true }), false);
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target" }, { pathId: "other", hasPendingWrites: false, data: { status: "queued" } }), { open: true, targetUid: "target" });
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target" }, { pathId: "target", hasPendingWrites: false, data: { status: "failed" } }), {
  open: false,
  targetUid: "target",
  feedback: "This account is already locked for permanent deletion and needs attention."
});
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target", submitting: true }, {
  pathId: "target", hasPendingWrites: true, data: { id: "other", status: "queued" }
}), { open: true, targetUid: "target", submitting: true });
assert.deepEqual(deletionJobRecord("target", { id: "other", status: "queued" }, false), {
  pathId: "target", data: { id: "other", status: "queued" }, hasPendingWrites: false
});
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target", submitting: true }, {
  pathId: "target", hasPendingWrites: false, data: { id: "other", status: "queued" }
}), {
  open: false,
  targetUid: "target",
  submitting: true,
  feedback: "Account locked. Permanent deletion queued."
});
assert.deepEqual(queueFailureDialogTransition({ open: true, targetUid: "target", submitting: true }, {
  pathId: "target", hasPendingWrites: false, data: { status: "completed" }
}), { open: false, targetUid: "target", submitting: true, feedback: "Account locked. Permanent deletion queued." });
assert.deepEqual(queueFailureDialogTransition({ open: true, targetUid: "target", submitting: true }, {
  pathId: "target", hasPendingWrites: true, data: { status: "queued" }
}), { open: true, targetUid: "target", submitting: false, feedback: "Could not queue permanent deletion. No changes were made." });
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target" }, {
  pathId: "other", hasPendingWrites: false, data: { id: "target", status: "queued" }
}), { open: true, targetUid: "target" });
assert.equal(resolveUserFocus({ activeFocusKey: "manage-delete-target", availableFocusKeys: ["manage-delete-target"], fallbackFocusKey: "admin-user-search" }), "manage-delete-target");
assert.equal(resolveUserFocus({ activeFocusKey: "manage-delete-target", availableFocusKeys: [], fallbackFocusKey: "admin-user-search" }), "admin-user-search");

assert.equal(processorHealth({ status: "started", updatedAt: now - 10 * 60 * 1000 }, now).kind, "working");
assert.equal(processorHealth({ status: "completed", updatedAt: now - 10 * 60 * 1000 - 1 }, now).kind, "delayed");
assert.equal(processorHealth({ status: "started", updatedAt: now - 20 * 60 * 1000 }, now).kind, "delayed");
assert.equal(processorHealth({ status: "completed", updatedAt: now - 20 * 60 * 1000 - 1 }, now).kind, "not-running");
assert.equal(processorHealth({ status: "error", updatedAt: now }, now).kind, "not-running");
assert.equal(processorHealth({ status: "working", updatedAt: now }, now).kind, "not-running");
assert.equal(processorHealth({ updatedAt: now }, now).kind, "not-running");
assert.equal(processorHealth({ status: "started", updatedAt: "unknown" }, now).kind, "not-running");

console.log("Admin dashboard policy behavior passed");
