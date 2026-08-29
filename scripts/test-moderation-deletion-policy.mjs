import assert from "node:assert/strict";
import {
  BATCH_LIMIT,
  LEASE_MS,
  PAGE_LIMIT,
  auditMarker,
  dependencyNamespaces,
  isClaimableJob,
  isExactCompletedJob,
  isExactQueuedJob,
  isTrustedRequester,
  jobIdForTarget
} from "../moderation-deletion-policy.mjs";

const instant = milliseconds => ({ toMillis: () => milliseconds });
const queued = {
  targetType: "post",
  targetId: "shared-id",
  reportId: "legacy-anchor",
  requesterUid: "admin",
  requestedAt: instant(1_000),
  status: "queued"
};

assert.equal(PAGE_LIMIT, 200);
assert.equal(BATCH_LIMIT, 400);
assert.equal(LEASE_MS, 5 * 60 * 1000);
assert.equal(jobIdForTarget("communityPost", "shared-id"), "communityPost_shared-id");
assert.equal(isExactQueuedJob(queued, "post_shared-id"), true);
assert.equal(isExactQueuedJob({ ...queued, extra: true }, "post_shared-id"), false);
assert.equal(isExactQueuedJob({ ...queued, targetType: "comment" }, "comment_shared-id"), false);
assert.equal(isExactQueuedJob({ ...queued, targetId: "other" }, "post_shared-id"), false);
assert.equal(isClaimableJob(queued, 2_000), true);
assert.equal(isClaimableJob({ ...queued, status: "failed", errorCode: "PROCESSOR_FAILURE" }, 2_000), true);
assert.equal(isClaimableJob({ ...queued, status: "processing", leaseExpiresAt: instant(1_999) }, 2_000), true);
assert.equal(isClaimableJob({ ...queued, status: "processing", leaseExpiresAt: instant(2_001) }, 2_000), false);

assert.equal(isTrustedRequester("admin", {
  uid: "admin", username: "i_love_you_h", banned: false
}, {
  uid: "admin", username: "i_love_you_h"
}), true);
assert.equal(isTrustedRequester("admin", {
  uid: "admin", username: "i_love_you_h", banned: true
}, {
  uid: "admin", username: "i_love_you_h"
}), false);

assert.deepEqual(dependencyNamespaces("post"), {
  targetCollection: "posts",
  action: "delete-post",
  voteCollection: "communityVotes",
  votePostCollection: "posts",
  deleteReposts: true,
  roomCollections: []
});
assert.deepEqual(dependencyNamespaces("communityPost"), {
  targetCollection: "communityPosts",
  action: "delete-post",
  voteCollection: "communityVotes",
  votePostCollection: "communityPosts",
  deleteReposts: false,
  roomCollections: []
});
assert.deepEqual(dependencyNamespaces("room"), {
  targetCollection: "rooms",
  action: "delete-room",
  voteCollection: null,
  votePostCollection: null,
  deleteReposts: false,
  roomCollections: ["roomMessages", "roomMembers"]
});
assert.equal(dependencyNamespaces("post").votePostCollection, "posts",
  "timeline vote cleanup is discriminated inside the live communityVotes collection");

const actedAt = instant(5_000);
const marker = auditMarker(queued, actedAt, 4);
assert.deepEqual(marker, {
  targetType: "post",
  targetId: "shared-id",
  action: "delete-post",
  adminId: "admin",
  actedAt,
  jobId: "post_shared-id",
  reportCount: 4
});
assert.equal(Object.hasOwn(marker, "reportId"), false,
  "target-wide deletion audit cannot depend on one report surviving cleanup");

const completed = {
  targetType: queued.targetType,
  targetId: queued.targetId,
  requesterUid: queued.requesterUid,
  requestedAt: queued.requestedAt,
  status: "completed",
  completedAt: instant(5_000),
  actionId: "post_shared-id",
  reportCount: 4
};
assert.equal(isExactCompletedJob(completed, "post_shared-id"), true);
assert.equal(isExactCompletedJob({ ...completed, leaseToken: "secret" }, "post_shared-id"), false);

console.log("Moderation deletion processor policy passed");
