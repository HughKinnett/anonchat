import assert from "node:assert/strict";
import * as moderationPolicy from "../moderation-policy.mjs";

const {
  DAY_MS,
  blockId,
  canShowActorContent,
  postIsVisible,
  postReportPayloads,
  reportId,
  restorePostPayload,
  restoreRoomPayload,
  roomReportPayloads,
  roomState
} = moderationPolicy;
assert.equal(typeof moderationPolicy.communityPostReportPayloads, "function");
const { communityPostReportPayloads } = moderationPolicy;

const timestamp = "STAMP";

assert.equal(DAY_MS, 86_400_000);
assert.equal(blockId("a", "b"), "a_b");
assert.equal(reportId("post", "p1", "u1"), "post_p1_u1");

assert.equal(canShowActorContent("actor", new Set()), true);
assert.equal(canShowActorContent("actor", new Set(["actor_blocker"])), false);
assert.equal(canShowActorContent("actor", new Set(["blocker_other"])), true);

assert.equal(postIsVisible({ moderationStatus: "reported" }, Date.now()), false);
assert.equal(postIsVisible({ expiresAt: { toMillis: () => 1 } }, 2), false);
assert.equal(postIsVisible({ expiresAt: { toMillis: () => 3 } }, 2), true);
assert.equal(postIsVisible({}, Date.now()), true);

assert.equal(roomState({ moderationStatus: "reported", expiresAt: { toMillis: () => 1 } }, 2), "reported");
assert.equal(roomState({ expiresAt: { toMillis: () => 1 } }, 2), "expired");
assert.equal(roomState({ expiresAt: { toMillis: () => 3 } }, 2), "active");

assert.deepEqual(postReportPayloads({
  targetId: "post-1",
  reporterId: "reporter-1",
  reportedUserId: "author-1",
  reason: "Spam",
  timestamp
}), {
  report: {
    targetType: "post",
    targetId: "post-1",
    reporterId: "reporter-1",
    reportedUserId: "author-1",
    reason: "Spam",
    status: "pending",
    createdAt: timestamp
  },
  post: {
    moderationStatus: "reported",
    reportedAt: timestamp
  }
});

assert.deepEqual(communityPostReportPayloads({
  targetId: "community-1",
  reporterId: "reporter-1",
  reportedUserId: "author-1",
  reason: "Other",
  timestamp
}), {
  report: {
    targetType: "communityPost",
    targetId: "community-1",
    reporterId: "reporter-1",
    reportedUserId: "author-1",
    reason: "Other",
    status: "pending",
    createdAt: timestamp
  },
  communityPost: {
    moderationStatus: "reported",
    reportedAt: timestamp
  }
});

assert.deepEqual(roomReportPayloads({
  targetId: "room-1",
  reporterId: "reporter-1",
  reportedUserId: "owner-1",
  reason: "Harassment",
  timestamp
}), {
  report: {
    targetType: "room",
    targetId: "room-1",
    reporterId: "reporter-1",
    reportedUserId: "owner-1",
    reason: "Harassment",
    status: "pending",
    createdAt: timestamp
  },
  room: {
    moderationStatus: "reported",
    reportedAt: timestamp
  }
});

assert.deepEqual(restorePostPayload({ resolvedAt: timestamp }), {
  moderationStatus: "active",
  reportedAt: null
});

assert.deepEqual(restoreRoomPayload({ resolvedAt: timestamp, expiresAt: "PLUS_24H" }), {
  moderationStatus: "active",
  reportedAt: null,
  resumedAt: timestamp,
  expiresAt: "PLUS_24H"
});

console.log("Moderation policy passed");
