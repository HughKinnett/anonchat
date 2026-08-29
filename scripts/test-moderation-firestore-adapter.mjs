import assert from "node:assert/strict";
import { isValidModerationIntake, restoreOutcome } from "../moderation-processor-policy.mjs";

const valid = { reporterUid: "reporter", targetKind: "post", targetCollection: "posts", targetId: "post", targetPath: "posts/post", reportedUserId: "author", reason: "harassment", status: "queued" };
assert.equal(isValidModerationIntake("reporter_post_post", valid), true);
assert.equal(isValidModerationIntake("reporter_room_room", {
  ...valid, targetKind: "room", targetCollection: "rooms", targetId: "room", targetPath: "rooms/room"
}), true, "canonical room reports are valid processor inputs");
for (const [id, intake] of [
  ["wrong", valid], ["reporter_post_post", { ...valid, reporterUid: "author" }], ["reporter_post_post", { ...valid, reason: "made-up" }],
  ["reporter_post_post", { ...valid, targetId: "bad/id", targetPath: "posts/bad/id" }],
  ["reporter_user_author", { ...valid, targetKind: "user", targetCollection: "users", targetId: "author", targetPath: "users/author", reportedUserId: "other" }]
]) assert.equal(isValidModerationIntake(id, intake), false, `${id} must be rejected`);
const runWithRetry = async (callback) => { await callback({ exists: true, data: { expiresAt: { toMillis: () => 1 } } }); return callback({ exists: true, data: { expiresAt: { toMillis: () => 20 } } }); };
const committed = await runWithRetry((source) => restoreOutcome({ targetKind: "roomMessage", status: "open" }, source, 10));
assert.equal(committed, "restored", "only the committed retry outcome controls follow-up action handling");
assert.equal(restoreOutcome({ targetKind: "roomMessage", status: "expiredEvidence" }, { exists: true, data: { expiresAt: { toMillis: () => 20 } } }, 10), "expired");
assert.equal(restoreOutcome({ targetKind: "room", status: "open" }, { exists: true, data: { expiresAt: { toMillis: () => 1 } } }, 10), "restored",
  "an expired retained room can be restored with a fresh lifecycle");
console.log("Moderation intake adapter behavior passed");
