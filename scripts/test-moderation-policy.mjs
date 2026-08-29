import assert from "node:assert/strict";
import * as moderationPolicy from "../moderation-policy.mjs";
const {
  REPORT_REASONS,
  REPORT_TARGETS,
  REPORT_BUTTON_CLASS,
  blockId,
  isRoomActive,
  reportId,
  reportHoldPatch,
  reportIntakePayload,
  roomExpiry
} = moderationPolicy;
await import("./test-interaction-parent-policy.mjs");

const NOW = 1_700_000_000_000;

assert.deepEqual(REPORT_REASONS, [
  "harassment",
  "hate-threats",
  "sexual-content",
  "spam-scam",
  "privacy-impersonation",
  "other"
]);
assert.deepEqual(REPORT_TARGETS, ["post", "communityPost", "room", "roomMessage", "user"]);
assert.equal(REPORT_BUTTON_CLASS, "follow-button report-button",
  "every report control reuses the Follow button design token");

for (const { blockerUid, blockedUid, expected } of [
  { blockerUid: "a", blockedUid: "b", expected: "a_b" },
  { blockerUid: "a/b", blockedUid: "b%c", expected: "a%2Fb_b%25c" }
]) {
  assert.equal(blockId(blockerUid, blockedUid), expected);
}
assert.throws(() => blockId("a", "a"), /self/);

for (const { reporterUid, targetKind, targetId, expected } of [
  { reporterUid: "u1", targetKind: "post", targetId: "p1", expected: "u1_post_p1" },
  { reporterUid: "u/1", targetKind: "roomMessage", targetId: "r%1", expected: "u%2F1_roomMessage_r%251" }
]) {
  assert.equal(reportId(reporterUid, targetKind, targetId), expected);
}
assert.throws(() => reportId("u1", "user", "u1"), /self/);

const collectionByTarget = {
  post: "posts",
  communityPost: "communityPosts",
  room: "rooms",
  roomMessage: "roomMessages",
  user: "users"
};
for (const [targetKind, targetCollection] of Object.entries(collectionByTarget)) {
  const targetId = targetKind === "user" ? "u2" : `${targetKind}-1`;
  assert.deepEqual(reportIntakePayload({
    reporterUid: "u1",
    targetKind,
    targetCollection,
    targetId,
    reportedUserId: "u2",
    reason: "harassment",
    timestamp: NOW
  }), {
    reporterUid: "u1",
    targetKind,
    targetCollection,
    targetId,
    targetPath: `${targetCollection}/${targetId}`,
    reportedUserId: "u2",
    reason: "harassment",
    createdAt: NOW,
    status: "queued"
  });
}

for (const targetKind of ["post", "communityPost", "room"]) {
  assert.deepEqual(reportHoldPatch({ reporterUid: "u1", targetKind, targetId: `${targetKind}-1`, timestamp: NOW }), {
    moderationState: "hidden",
    moderationHoldId: `u1_${targetKind}_${targetKind}-1`,
    moderationHeldAt: NOW
  }, `${targetKind} reports produce the exact atomic hidden hold`);
}
assert.equal(reportHoldPatch({ reporterUid: "u1", targetKind: "roomMessage", targetId: "message-1", timestamp: NOW }), null,
  "legacy room-message reports retain their processor-only path");
assert.throws(() => reportIntakePayload({
  reporterUid: "u1", targetKind: "post", targetCollection: "posts", targetId: "p1",
  reportedUserId: "u1", reason: "harassment", timestamp: NOW
}), /self/);
assert.throws(() => reportIntakePayload({
  reporterUid: "u1", targetKind: "post", targetCollection: "communityPosts", targetId: "p1",
  reportedUserId: "u2", reason: "harassment", timestamp: NOW
}), /target collection/);
assert.throws(() => reportIntakePayload({
  reporterUid: "u1", targetKind: "post", targetCollection: "posts", targetId: "p1",
  reportedUserId: "u2", reason: "not-a-reason", timestamp: NOW
}), /reason/);
assert.throws(() => reportIntakePayload({
  reporterUid: "u1", targetKind: "post", targetCollection: "posts", targetId: "a/b",
  reportedUserId: "u2", reason: "harassment", timestamp: NOW
}), /target id/);

assert.equal(roomExpiry(1_000), 86_401_000);
assert.equal(isRoomActive({ expiresAt: NOW + 1 }, NOW), true);
assert.equal(isRoomActive({ expiresAt: NOW }, NOW), false);
assert.equal(isRoomActive({ expiresAt: { toMillis: () => NOW + 1 } }, NOW), true);
assert.equal(isRoomActive({ expiresAt: "not-a-timestamp" }, NOW), false);

console.log("Moderation policy passed");
