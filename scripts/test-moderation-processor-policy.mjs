import assert from "node:assert/strict";
import {
  LEASE_MS, PAGE_SIZE, MAX_ATTEMPTS, SNAPSHOT_TEXT_LIMIT, SNAPSHOT_MEDIA_LIMIT, LEGACY_ROOM_GRACE_MS, caseId, isLeaseEligible, isTerminalModerationRecord,
  retryDelayMillis, snapshotForTarget, redactedSummary, fixedErrorCode
} from "../moderation-processor-policy.mjs";

const time = (milliseconds) => ({ toMillis: () => milliseconds });
assert.equal(LEASE_MS, 4 * 60 * 1000);
assert.equal(PAGE_SIZE, 100);
assert.equal(MAX_ATTEMPTS, 8);
assert.equal(SNAPSHOT_TEXT_LIMIT, 500);
assert.equal(SNAPSHOT_MEDIA_LIMIT, 780000);
assert.equal(LEGACY_ROOM_GRACE_MS, 7 * 24 * 60 * 60 * 1000);
assert.equal(caseId("post", "a/b c"), "post_a%2Fb%20c");
assert.equal(isLeaseEligible({ status: "queued" }, 10), true);
assert.equal(isLeaseEligible({ status: "failed", nextAttemptAt: time(11) }, 10), false);
assert.equal(isLeaseEligible({ status: "failed", nextAttemptAt: time(10) }, 10), true);
assert.equal(isTerminalModerationRecord({ status: "failed", attempts: 8 }), true);
assert.equal(isTerminalModerationRecord({ status: "failed", attempts: 7 }), false);
assert.equal(isTerminalModerationRecord({ status: "processing", attempts: 8 }), false);
assert.equal(isLeaseEligible({ status: "processing", leaseExpiresAt: time(10) }, 10), true);
assert.equal(isLeaseEligible({ status: "processing", leaseExpiresAt: time(11) }, 10), false);
assert.equal(retryDelayMillis(1), 1_000);
assert.equal(retryDelayMillis(4), 8_000);
assert.equal(retryDelayMillis(MAX_ATTEMPTS), 60_000);

const long = "x".repeat(600);
const photo = "data:image/jpeg;base64,AAAA";
assert.deepEqual(snapshotForTarget("post", { authorId: "author", username: "Name", content: long, imageData: photo, category: "Post" }), {
  kind: "post", authorId: "author", authorName: "Name", text: "x".repeat(SNAPSHOT_TEXT_LIMIT), media: [{ kind: "postImage", dataUrl: photo }], category: "Post"
});
assert.deepEqual(snapshotForTarget("communityPost", { authorId: "author", username: "Name", content: "hello", category: "Question", options: ["a", "b"] }), {
  kind: "communityPost", authorId: "author", authorName: "Name", text: "hello", category: "Question", optionCount: 2
});
const expiry = time(88);
assert.deepEqual(snapshotForTarget("roomMessage", { senderId: "author", tempName: "Temp", text: "hello", roomId: "room", expiresAt: expiry }), {
  kind: "roomMessage", authorId: "author", authorName: "Temp", text: "hello", roomId: "room", expiresAt: expiry
});
const avatar = "data:image/png;base64,AAAA";
const cover = "data:image/webp;base64,BBBB";
assert.deepEqual(snapshotForTarget("user", { uid: "author", username: "Name", bio: "ignored", profileImage: avatar, coverImage: cover }), {
  kind: "user", authorId: "author", authorName: "Name", media: [{ kind: "profileImage", dataUrl: avatar }, { kind: "coverImage", dataUrl: cover }]
});
assert.deepEqual(snapshotForTarget("post", { authorId: "author", imageData: "javascript:alert(1)" }).media, [], "unsafe media references are not retained");
assert.deepEqual(snapshotForTarget("post", { authorId: "author", imageData: `data:image/jpeg;base64,${"A".repeat(SNAPSHOT_MEDIA_LIMIT)}` }).media, [], "oversized evidence never bloats a case document");
assert.throws(() => snapshotForTarget("directMessage", { text: "private" }), /unsupported-target/);
const summary = redactedSummary({ inspected: 1, processed: 2, failed: 3, skipped: 4, expiredRooms: 5, backfilled: 6 });
assert.equal(summary, "MODERATION_RESULT inspected=1 processed=2 failed=3 skipped=4 terminalIntakes=0 terminalActions=0 expiredRooms=5 backfilled=6 roomLifecycleMigrated=0 roomLifecycleQuarantined=0 roomLifecycleDeferred=0 legacyRoomsCleaned=0 legacyRoomsManualReview=0");
assert.equal(/author|hello|uid/i.test(summary), false);
assert.equal(fixedErrorCode({ code: 9 }), "FIRESTORE_FAILED_PRECONDITION");
assert.equal(fixedErrorCode({ code: "permission-denied" }), "FIRESTORE_PERMISSION_DENIED");
assert.equal(fixedErrorCode({ code: "unknown-sensitive-value" }), "PROCESSOR_FAILURE");
console.log("Moderation processor policy passed");
