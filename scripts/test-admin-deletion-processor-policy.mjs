import assert from "node:assert/strict";
import {
  BATCH_LIMIT, COMPLETION_RETENTION_MS, PAGE_LIMIT, cleanupQueries, completionMarker,
  fixedErrorCode, isClaimableJob, isExactCompletionMarker, isExactQueuedJob,
  isProtectedAdministrator, isTrustedRequester
} from "../admin-deletion-processor-policy.mjs";
const instant = (milliseconds) => ({ toMillis: () => milliseconds });
const requestedAt = instant(1_000);
const queued = { targetUid: "target", requesterUid: "admin", requestedAt, status: "queued" };
assert.equal(PAGE_LIMIT, 200); assert.equal(BATCH_LIMIT, 400);
assert.equal(isExactQueuedJob(queued, "target"), true);
assert.equal(isExactQueuedJob({ ...queued, extra: true }, "target"), false);
assert.equal(isExactQueuedJob({ ...queued, targetUid: "other" }, "target"), false);
assert.equal(isProtectedAdministrator("\u00a0 I_LOVE_YOU_H \ufeff"), true);
assert.equal(isProtectedAdministrator("ownerCyberCapone"), true);
assert.equal(isProtectedAdministrator("ordinary"), false);
assert.equal(isTrustedRequester("admin", { uid: "admin", username: "i_love_you_h", banned: false }, { uid: "admin", username: "i_love_you_h" }), true);
assert.equal(isTrustedRequester("admin", { uid: "admin", username: "i_love_you_h", banned: true }, { uid: "admin", username: "i_love_you_h" }), false);
assert.equal(isTrustedRequester("admin", { uid: "admin", username: "i_love_you_h", banned: false }, { uid: "other", username: "i_love_you_h" }), false);
assert.equal(isClaimableJob(queued, 10_000), true);
assert.equal(isClaimableJob({ ...queued, status: "failed", phase: "first-sweep" }, 10_000), true);
assert.equal(isClaimableJob({ ...queued, status: "processing", leaseExpiresAt: instant(9_999) }, 10_000), true);
assert.equal(isClaimableJob({ ...queued, status: "processing", leaseExpiresAt: instant(10_001) }, 10_000), false);
const marker = completionMarker(instant(20_000), (value) => instant(value));
assert.deepEqual(Object.keys(marker).sort(), ["completedAt", "purgeAfter", "status"]);
assert.equal(marker.purgeAfter.toMillis() - marker.completedAt.toMillis(), COMPLETION_RETENTION_MS);
assert.equal(isExactCompletionMarker(marker), true);
assert.equal(isExactCompletionMarker({ ...marker, targetUid: "target" }), false);
const queries = cleanupQueries("target", "target_name");
assert.ok(queries.every((entry) => entry.limit <= PAGE_LIMIT));
for (const required of [
  "owned-posts", "reposts-of-target", "comments-by-target", "replies-by-target", "reactions-by-target",
  "votes-by-target", "timeline-votes-by-target", "follows-from-target", "follows-to-target", "direct-messages",
  "message-requests-from-target", "message-requests-to-target", "reveals-from-target", "reveals-to-target",
  "owned-rooms", "room-memberships", "owned-circles", "circle-memberships", "preferences", "private-profile",
  "reports-by-target", "reports-about-target", "blocks-by-target", "blocks-of-target", "push-subscriptions",
  "notification-events", "notification-deliveries", "self-deletion-request"
]) assert.ok(queries.some((entry) => entry.name === required), `missing ${required}`);
assert.ok(queries.some((entry) => entry.cascade === "post"));
assert.ok(queries.some((entry) => entry.cascade === "circle"));
assert.ok(queries.some((entry) => entry.cascade === "room"));
assert.ok(queries.some((entry) => entry.field === "username" && entry.value === "target_name"));
assert.equal(fixedErrorCode({ code: "auth/user-not-found" }), "AUTH_NOT_FOUND");
assert.equal(fixedErrorCode({ code: "lease-lost", message: "secret-uid" }), "LEASE_LOST");
assert.equal(fixedErrorCode(new Error("secret-uid")), "PROCESSOR_FAILURE");
console.log("Administrator deletion processor policy passed");
