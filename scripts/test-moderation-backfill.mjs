import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreModerationAdapter } from "../moderation-firestore-adapter.mjs";
import { processModeration } from "../moderation-processor.mjs";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator is required");
const app = initializeApp({ projectId: "anonchat-moderation-backfill-test" }, "anonchat-moderation-backfill-test");
const db = getFirestore(app);
const put = async (entries) => {
  const batch = db.batch();
  entries.forEach(([path, data]) => batch.set(db.doc(path), data));
  await batch.commit();
};
try {
  await put([
    ["posts/legacy", { content: "legacy" }],
    ["posts/hidden", { moderationState: "hidden" }],
    ["posts/explicit", { moderationState: "archived" }],
    ["communityPosts/legacy", { content: "legacy" }],
    ["communityPosts/hidden", { moderationState: "hidden" }],
    ["rooms/legacy-active", { ownerId: "author", createdAt: Timestamp.fromMillis(10) }],
    ["rooms/legacy-hidden", { ownerId: "author", createdAt: Timestamp.fromMillis(10), moderationState: "hidden" }],
    ["rooms/legacy-expired", { ownerId: "author", createdAt: Timestamp.fromMillis(-86_400_001) }],
    ["rooms/missing-created-at", { ownerId: "author" }],
    ["rooms/invalid-parent-time", { ownerId: "author", expiresAt: Timestamp.fromMillis(86_400_010), createdAt: "invalid" }],
    ["roomMessages/legacy-active", { roomId: "legacy-active", senderId: "author", text: "legacy" }],
    ["roomMessages/legacy-expired", { roomId: "legacy-expired", senderId: "author", text: "expired" }],
    ["roomMessages/orphan-finite", { roomId: "missing-room", senderId: "author", expiresAt: Timestamp.fromMillis(86_400_010) }],
    ["roomMessages/malformed-parent", { roomId: null, senderId: "author", expiresAt: Timestamp.fromMillis(86_400_010) }],
    ["roomMessages/invalid-parent-time", { roomId: "invalid-parent-time", senderId: "author" }]
  ]);
  const failing = new FirestoreModerationAdapter({
    db, Timestamp, FieldPath, clock: () => 10,
    beforeBackfillPage: ({ collection }) => { if (collection === "communityPosts") throw new Error("injected"); }
  });
  await assert.rejects(() => processModeration(failing, { logger: { error() {} } }), /injected/);
  assert.equal((await db.doc("posts/legacy").get()).data().moderationState, "visible");
  assert.equal((await db.doc("communityPosts/legacy").get()).data().moderationState, undefined);
  assert.equal((await db.doc("system/moderationStateBackfill").get()).exists, false, "failure never completes the marker");

  const lifecycleFailing = new FirestoreModerationAdapter({
    db, Timestamp, FieldPath, clock: () => 20,
    beforeRoomLifecyclePage: () => { throw new Error("lifecycle-injected"); }
  });
  await assert.rejects(() => processModeration(lifecycleFailing, { logger: { error() {} } }), /lifecycle-injected/);
  assert.equal((await db.doc("system/roomLifecycleBackfill").get()).exists, false, "a partial lifecycle page never marks migration complete");

  const adapter = new FirestoreModerationAdapter({ db, Timestamp, FieldPath, clock: () => 20 });
  await processModeration(adapter, { logger: { error() {} } });
  assert.equal((await db.doc("communityPosts/legacy").get()).data().moderationState, "visible");
  assert.equal((await db.doc("posts/hidden").get()).data().moderationState, "hidden");
  assert.equal((await db.doc("communityPosts/hidden").get()).data().moderationState, "hidden");
  assert.equal((await db.doc("posts/explicit").get()).data().moderationState, "archived");
  const activeRoom = (await db.doc("rooms/legacy-active").get()).data();
  assert.equal(activeRoom.moderationState, "visible");
  assert.equal(activeRoom.expiresAt.toMillis(), 86_400_010, "legacy room expiry derives from authoritative createdAt");
  assert.equal((await db.doc("rooms/legacy-hidden").get()).data().moderationState, "hidden", "migration preserves hidden state");
  const activeMessage = (await db.doc("roomMessages/legacy-active").get()).data();
  assert.equal(activeMessage.moderationState, "visible");
  assert.equal(activeMessage.expiresAt.toMillis(), activeRoom.expiresAt.toMillis(), "legacy message takes its room's exact expiry");
  assert.equal(activeMessage.createdAt.toMillis(), activeRoom.createdAt.toMillis(), "missing message time derives only from its authoritative parent room");
  const quarantined = (await db.doc("rooms/missing-created-at").get()).data();
  assert.equal(quarantined.expiresAt, undefined, "a room without authoritative createdAt is not assigned an invented epoch expiry");
  assert.equal(quarantined.moderationState, undefined, "a quarantined room is never exposed by visible queries");
  assert.equal(quarantined.lifecycleMigrationState, "missing-created-at");
  const quarantineQueue = (await db.doc("legacyRoomQuarantine/missing-created-at").get()).data();
  assert.equal(quarantineQueue.status, "quarantined");
  assert.equal(quarantineQueue.policy, "cleanup-after-grace");
  assert.equal(quarantineQueue.graceExpiresAt.toMillis(), 20 + 7 * 24 * 60 * 60 * 1000);
  const invalidParentMessage = (await db.doc("roomMessages/invalid-parent-time").get()).data();
  assert.equal(invalidParentMessage.createdAt, undefined, "invalid parent creation time is never copied to a message");
  assert.equal(invalidParentMessage.moderationState, undefined, "a message of a quarantined parent remains hidden");
  assert.equal(invalidParentMessage.lifecycleMigrationState, "parent-invalid-timestamp");
  assert.equal((await db.doc("roomMessages/orphan-finite").get()).exists, false, "finite-expiry orphan messages are handled before completion");
  assert.equal((await db.doc("roomMessages/malformed-parent").get()).exists, false, "malformed room identifiers do not poison migration pages");
  assert.equal((await db.doc("rooms/legacy-expired").get()).exists, false, "expired legacy room is cleaned");
  assert.equal((await db.doc("roomMessages/legacy-expired").get()).exists, false, "expired legacy room data is cleaned");
  assert.deepEqual((await db.doc("system/roomLifecycleBackfill").get()).data().status, "completed");
  const marker = await db.doc("system/moderationStateBackfill").get();
  assert.equal(marker.data().status, "completed");

  const repeated = new FirestoreModerationAdapter({
    db, Timestamp, FieldPath, clock: () => 30,
    beforeBackfillPage: () => { throw new Error("backfill should be a no-op after completion"); }
  });
  await processModeration(repeated, { logger: { error() {} } });
  assert.equal((await db.doc("system/moderationStateBackfill").get()).data().completedAt.toMillis(), 20);

  await put([
    ["rooms/manual-review", { ownerId: "author", lifecycleMigrationState: "missing-created-at" }],
    ["legacyRoomQuarantine/manual-review", { roomId: "manual-review", status: "processing", reason: "missing-or-invalid-created-at", policy: "cleanup-after-grace", quarantinedAt: Timestamp.fromMillis(20), graceExpiresAt: Timestamp.fromMillis(20), attempts: 8, leaseExpiresAt: Timestamp.fromMillis(20) }],
    ["rooms/repaired-before-cleanup", { ownerId: "author", lifecycleMigrationState: "missing-created-at" }],
    ["legacyRoomQuarantine/repaired-before-cleanup", { roomId: "repaired-before-cleanup", status: "quarantined", reason: "missing-or-invalid-created-at", policy: "cleanup-after-grace", quarantinedAt: Timestamp.fromMillis(20), graceExpiresAt: Timestamp.fromMillis(20), attempts: 0 }]
  ]);
  const cleanupNow = 21 + 7 * 24 * 60 * 60 * 1000;
  let repairedAtBoundary = false;
  const afterGrace = new FirestoreModerationAdapter({
    db, Timestamp, FieldPath, clock: () => cleanupNow, tokenFactory: () => "legacy-cleanup",
    beforeRoomCleanupClaim: async ({ roomId }) => {
      if (roomId !== "repaired-before-cleanup" || repairedAtBoundary) return;
      repairedAtBoundary = true;
      await db.doc("rooms/repaired-before-cleanup").set({
        ownerId: "author", createdAt: Timestamp.fromMillis(cleanupNow), expiresAt: Timestamp.fromMillis(cleanupNow + 86_400_000)
      });
    }
  });
  const terminal = await processModeration(afterGrace, { ownerId: "legacy-cleanup", logger: { error() {} } });
  assert.equal(terminal.legacyRoomsCleaned, 2);
  assert.equal(terminal.legacyRoomsManualReview, 1);
  assert.equal((await db.doc("rooms/missing-created-at").get()).exists, false, "quarantined rooms reach terminal cleanup after bounded grace");
  assert.equal((await db.doc("rooms/invalid-parent-time").get()).exists, false);
  assert.equal((await db.doc("legacyRoomQuarantine/missing-created-at").get()).data().status, "cleaned", "the durable audit queue records terminal cleanup");
  assert.equal((await db.doc("legacyRoomQuarantine/manual-review").get()).data().status, "manualReview", "an exhausted abandoned cleanup is explicitly terminal and auditable");
  assert.equal((await db.doc("rooms/manual-review").get()).exists, true, "manual-review policy preserves the room for an administrator decision");
  assert.equal((await db.doc("rooms/repaired-before-cleanup").get()).exists, true, "destructive cleanup revalidates a repaired room after the queue scan");
  assert.equal((await db.doc("legacyRoomQuarantine/repaired-before-cleanup").get()).data().status, "resolved", "the audit queue records the repaired-room resolution");
  await put([
    ["legacyRoomActions/release-manual", { roomId: "manual-review", action: "release", requestedAt: Timestamp.fromMillis(cleanupNow), requestedBy: "admin", status: "queued" }],
    ["rooms/approved-cleanup", { ownerId: "author", lifecycleMigrationState: "missing-created-at" }],
    ["legacyRoomQuarantine/approved-cleanup", { roomId: "approved-cleanup", status: "manualReview", reason: "attempt-limit", policy: "manual-review", attempts: 8, terminalAt: Timestamp.fromMillis(cleanupNow) }],
    ["legacyRoomActions/approve-cleanup", { roomId: "approved-cleanup", action: "approveCleanup", requestedAt: Timestamp.fromMillis(cleanupNow), requestedBy: "admin", status: "queued" }]
  ]);
  await processModeration(new FirestoreModerationAdapter({ db, Timestamp, FieldPath, clock: () => cleanupNow + 1, tokenFactory: () => "admin-reviewed" }), { ownerId: "admin-reviewed", logger: { error() {} } });
  assert.equal((await db.doc("legacyRoomQuarantine/manual-review").get()).data().status, "released", "an administrator can release a preserved legacy room");
  assert.equal((await db.doc("rooms/manual-review").get()).data().cleanupState, "released");
  assert.equal((await db.doc("legacyRoomActions/release-manual").get()).data().status, "completed", "the release decision remains audited");
  assert.equal((await db.doc("rooms/approved-cleanup").get()).exists, false, "an approved manual-review cleanup reaches terminal deletion");
  assert.equal((await db.doc("legacyRoomQuarantine/approved-cleanup").get()).data().status, "cleaned");
  assert.equal((await db.doc("legacyRoomActions/approve-cleanup").get()).data().status, "completed", "the cleanup approval remains audited");
  console.log("Moderation visibility backfill passed");
} finally {
  await deleteApp(app);
}
