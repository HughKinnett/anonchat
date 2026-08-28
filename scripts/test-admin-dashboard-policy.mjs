import assert from "node:assert/strict";
import {
  canConfirmDeletion,
  deletionDialogJobTransition,
  filterUsers,
  processorHealth,
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
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target" }, { id: "other", status: "queued" }), { open: true, targetUid: "target" });
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target" }, { id: "target", status: "failed" }), {
  open: false,
  targetUid: "target",
  feedback: "This account is already locked for permanent deletion and needs attention."
});

assert.equal(processorHealth({ updatedAt: now - 10 * 60 * 1000 }, now).kind, "working");
assert.equal(processorHealth({ updatedAt: now - 10 * 60 * 1000 - 1 }, now).kind, "delayed");
assert.equal(processorHealth({ updatedAt: now - 20 * 60 * 1000 }, now).kind, "delayed");
assert.equal(processorHealth({ updatedAt: now - 20 * 60 * 1000 - 1 }, now).kind, "not-running");
assert.equal(processorHealth({ status: "failed", updatedAt: now }, now).kind, "not-running");
assert.equal(processorHealth({ updatedAt: "unknown" }, now).kind, "not-running");

console.log("Admin dashboard policy behavior passed");
