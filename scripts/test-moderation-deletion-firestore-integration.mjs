import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreModerationDeletionAdapter } from "../moderation-deletion-firestore-adapter.mjs";
import { runModerationDeletionProcessor } from "../moderation-deletion-processor.mjs";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator is required");

const app = initializeApp({ projectId: "anonchat-moderation-deletion-integration" }, "moderation-deletion-integration");
const db = getFirestore(app);
const now = 1_800_000_000_000;
const quiet = { info() {}, error() {} };

const putMany = async entries => {
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch();
    entries.slice(offset, offset + 400).forEach(([path, value]) => batch.set(db.doc(path), value));
    await batch.commit();
  }
};

const adminEntries = [
  ["users/admin", { uid: "admin", username: "i_love_you_h", banned: false }],
  ["usernames/i_love_you_h", { uid: "admin", username: "i_love_you_h" }]
];

const report = (targetType, targetId, id, status = "pending") => [
  `reports/${id}`,
  {
    targetType,
    targetId,
    reporterId: id,
    reportedUserId: "owner",
    reason: "Spam",
    status,
    createdAt: Timestamp.fromMillis(now - 10_000)
  }
];

const job = (targetType, targetId, reportId) => [
  `moderationDeletionJobs/${targetType}_${targetId}`,
  {
    targetType,
    targetId,
    reportId,
    requesterUid: "admin",
    requestedAt: Timestamp.fromMillis(now - 5_000),
    status: "queued"
  }
];

const makeAdapter = () => new FirestoreModerationDeletionAdapter({
  db,
  Timestamp,
  FieldPath,
  clock: () => now,
  tokenFactory: () => `token-${crypto.randomUUID()}`
});

try {
  await putMany([
    ...adminEntries,
    ["rooms/large-room", {
      name: "Large evidence room",
      topic: "Preserved",
      ownerId: "owner",
      moderationStatus: "reported",
      reportedAt: Timestamp.fromMillis(now - 20_000),
      createdAt: Timestamp.fromMillis(now - 30_000),
      expiresAt: Timestamp.fromMillis(now - 1)
    }],
    report("room", "large-room", "room-anchor"),
    report("room", "large-room", "legacy-duplicate-a"),
    report("room", "large-room", "legacy-duplicate-z", "resolved"),
    job("room", "large-room", "room-anchor"),
    ...Array.from({ length: 405 }, (_, index) => [
      `roomMessages/message-${String(index).padStart(4, "0")}`,
      { roomId: "large-room", senderId: "member", text: `evidence ${index}`, createdAt: Timestamp.fromMillis(now - index) }
    ]),
    ...Array.from({ length: 7 }, (_, index) => [
      `roomMembers/member-${String(index).padStart(2, "0")}`,
      { roomId: "large-room", uid: `member-${index}`, joinedAt: Timestamp.fromMillis(now - index) }
    ])
  ]);

  const first = await runModerationDeletionProcessor({ adapter: makeAdapter(), ownerId: "room-worker", logger: quiet });
  assert.deepEqual(first, { inspected: 1, processed: 1, failed: 0, skipped: 0, cleaned: 0 });
  assert.equal((await db.doc("rooms/large-room").get()).exists, false);
  assert.equal((await db.collection("roomMessages").where("roomId", "==", "large-room").get()).empty, true);
  assert.equal((await db.collection("roomMembers").where("roomId", "==", "large-room").get()).empty, true);
  assert.equal((await db.collection("reports").where("targetType", "==", "room").where("targetId", "==", "large-room").get()).empty, true);
  const roomAction = (await db.doc("moderationActions/room_large-room").get()).data();
  assert.equal(roomAction.action, "delete-room");
  assert.equal(roomAction.reportCount, 3);
  assert.equal(Object.hasOwn(roomAction, "reportId"), false);
  const completedRoomJob = (await db.doc("moderationDeletionJobs/room_large-room").get()).data();
  assert.equal(completedRoomJob.status, "completed");
  assert.equal(Object.hasOwn(completedRoomJob, "reportId"), false,
    "durable completion state is target-wide rather than anchored to a removed report");
  assert.equal((await runModerationDeletionProcessor({ adapter: makeAdapter(), ownerId: "idempotent", logger: quiet })).processed, 0);

  await putMany([
    ["posts/shared-id", {
      type: "original", authorId: "owner", username: "owner", content: "reported",
      moderationStatus: "reported", reportedAt: Timestamp.fromMillis(now - 5_000), createdAt: Timestamp.fromMillis(now - 10_000)
    }],
    ["communityPosts/shared-id", {
      authorId: "owner", username: "owner", content: "community active",
      moderationStatus: "active", createdAt: Timestamp.fromMillis(now - 10_000)
    }],
    ["communityVotes/posts_shared-id_member", {
      postCollection: "posts", postId: "shared-id", uid: "member", option: 0
    }],
    ["communityVotes/communityPosts_shared-id_member", {
      postCollection: "communityPosts", postId: "shared-id", uid: "member", option: 1
    }],
    ["communityVotes/legacy-shared", { postId: "shared-id", uid: "legacy", option: 2 }],
    ["posts/repost-shared", { type: "repost", authorId: "member", originalPostId: "shared-id" }],
    ["posts/repost-shared/comments/comment", { uid: "member", text: "dependent" }],
    ["communityVotes/posts_repost-shared_member", {
      postCollection: "posts", postId: "repost-shared", uid: "member", option: 0
    }],
    ["communityVotes/legacy-repost-shared", { postId: "repost-shared", uid: "legacy", option: 1 }],
    report("post", "shared-id", "post-anchor"),
    job("post", "shared-id", "post-anchor")
  ]);
  const postResult = await runModerationDeletionProcessor({ adapter: makeAdapter(), ownerId: "post-worker", logger: quiet });
  assert.equal(postResult.processed, 1);
  assert.equal((await db.doc("communityVotes/posts_shared-id_member").get()).exists, false);
  assert.equal((await db.doc("posts/repost-shared").get()).exists, false);
  assert.equal((await db.doc("posts/repost-shared/comments/comment").get()).exists, false);
  assert.equal((await db.doc("communityVotes/posts_repost-shared_member").get()).exists, false);
  assert.equal((await db.doc("communityVotes/legacy-repost-shared").get()).exists, false,
    "unambiguous legacy repost votes are cleaned safely");
  assert.equal((await db.doc("communityVotes/communityPosts_shared-id_member").get()).exists, true,
    "timeline deletion never crosses the postCollection discriminator");
  assert.equal((await db.doc("communityVotes/legacy-shared").get()).exists, true,
    "same-ID legacy votes remain untouched while both target collections exist");

  await putMany([
    ["communityPosts/shared-id", {
      authorId: "owner", username: "owner", content: "community reported",
      moderationStatus: "reported", reportedAt: Timestamp.fromMillis(now - 5_000), createdAt: Timestamp.fromMillis(now - 10_000)
    }],
    report("communityPost", "shared-id", "community-anchor"),
    job("communityPost", "shared-id", "community-anchor")
  ]);
  const communityResult = await runModerationDeletionProcessor({ adapter: makeAdapter(), ownerId: "community-worker", logger: quiet });
  assert.equal(communityResult.processed, 1);
  assert.equal((await db.doc("communityVotes/communityPosts_shared-id_member").get()).exists, false,
    "community vote cleanup uses the communityPosts discriminator");
  assert.equal((await db.doc("communityVotes/legacy-shared").get()).exists, false,
    "the remaining legacy vote becomes unambiguous after the timeline target is gone");

  await putMany([
    ["posts/lock-post", {
      type: "original", authorId: "owner", username: "owner", content: "lock test",
      moderationStatus: "reported", reportedAt: Timestamp.fromMillis(now - 5_000), createdAt: Timestamp.fromMillis(now - 10_000)
    }],
    ["posts/lock-repost", {
      type: "repost", authorId: "member", originalPostId: "lock-post",
      moderationStatus: "active", createdAt: Timestamp.fromMillis(now - 8_000)
    }],
    report("post", "lock-post", "lock-anchor"),
    job("post", "lock-post", "lock-anchor")
  ]);
  class FailAfterRepostLockAdapter extends FirestoreModerationDeletionAdapter {
    async cleanDependencies() { throw Object.assign(new Error("transient"), { code: "unavailable" }); }
  }
  const lockAdapter = new FailAfterRepostLockAdapter({
    db, Timestamp, FieldPath, clock: () => now, tokenFactory: () => "lock-token"
  });
  const lockFailure = await runModerationDeletionProcessor({ adapter: lockAdapter, ownerId: "lock-worker", logger: quiet });
  assert.equal(lockFailure.failed, 1);
  assert.equal((await db.doc("posts/lock-repost").get()).data().moderationStatus, "reported",
    "every dependent repost is noninteractive before subtree cleanup starts");
  assert.equal((await db.doc("moderationDeletionJobs/post_lock-post").get()).data().phase, "reposts-locked",
    "a crash preserves the durable repost lock phase");
  const lockRetry = await runModerationDeletionProcessor({ adapter: makeAdapter(), ownerId: "lock-retry", logger: quiet });
  assert.equal(lockRetry.processed, 1);

  await putMany([
    ["posts/retry-post", {
      type: "original", authorId: "owner", username: "owner", content: "retry",
      moderationStatus: "reported", reportedAt: Timestamp.fromMillis(now - 5_000), createdAt: Timestamp.fromMillis(now - 10_000)
    }],
    report("post", "retry-post", "retry-anchor"),
    report("post", "retry-post", "retry-duplicate"),
    job("post", "retry-post", "retry-anchor")
  ]);
  class PartialFailureAdapter extends FirestoreModerationDeletionAdapter {
    constructor(options) { super(options); this.failOnce = true; }
    async removeReports(jobId, token) {
      if (!this.failOnce) return super.removeReports(jobId, token);
      this.failOnce = false;
      const snapshot = await this.jobRef(jobId).get();
      const firstReport = await this.reportQuery(snapshot.data()).limit(1).get();
      await this.deleteRefs(jobId, token, firstReport.docs.map(document => document.ref));
      throw Object.assign(new Error("transient"), { code: "unavailable" });
    }
  }
  const partialAdapter = new PartialFailureAdapter({ db, Timestamp, FieldPath, clock: () => now, tokenFactory: () => "partial-token" });
  const partial = await runModerationDeletionProcessor({ adapter: partialAdapter, ownerId: "partial-worker", logger: quiet });
  assert.equal(partial.failed, 1);
  assert.equal((await db.doc("posts/retry-post").get()).data().moderationStatus, "reported");
  const remainingRetryReports = await db.collection("reports").where("targetType", "==", "post").where("targetId", "==", "retry-post").get();
  assert.equal(remainingRetryReports.size, 1);
  assert.equal(remainingRetryReports.docs[0].data().status, "resolved",
    "partial cleanup leaves the target locked and the durable report phase observable for retry");
  assert.equal(remainingRetryReports.docs[0].data().resolutionAction, "delete-post");
  const retry = await runModerationDeletionProcessor({ adapter: makeAdapter(), ownerId: "retry-worker", logger: quiet });
  assert.equal(retry.processed, 1);
  assert.equal((await db.doc("posts/retry-post").get()).exists, false);
  assert.equal((await db.collection("reports").where("targetType", "==", "post").where("targetId", "==", "retry-post").get()).empty, true);

  await putMany([
    ["reports/resolved-cleanup", {
      targetType: "post", targetId: "restored", reporterId: "member", reportedUserId: "owner",
      reason: "Spam", status: "resolved", createdAt: Timestamp.fromMillis(now - 20_000),
      resolvedBy: "admin", resolutionAction: "restore-post", resolvedAt: Timestamp.fromMillis(now - 10_000)
    }],
    ["moderationActions/post_restored", {
      targetType: "post", targetId: "restored", reportIds: ["resolved-cleanup"], reportCount: 1,
      action: "restore-post", adminId: "admin", actedAt: Timestamp.fromMillis(now - 10_000)
    }]
  ]);
  const cleanup = await runModerationDeletionProcessor({ adapter: makeAdapter(), ownerId: "cleanup-worker", logger: quiet });
  assert.equal(cleanup.cleaned, 1, "scheduled cleanup durably retries resolved-report removal");
  assert.equal((await db.doc("reports/resolved-cleanup").get()).exists, false);
} finally {
  await deleteApp(app);
}

console.log("Moderation deletion Firestore integration passed");
