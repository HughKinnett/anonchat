import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreModerationAdapter } from "../moderation-firestore-adapter.mjs";
import { caseId } from "../moderation-processor-policy.mjs";
import { processModeration } from "../moderation-processor.mjs";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator is required");
const apps = []; let number = 0;
const scenario = (now = 2_000_000_000_000, options = {}) => {
  const app = initializeApp({ projectId: `anonchat-moderation-integration-${++number}` }, `anonchat-moderation-integration-${number}`); apps.push(app);
  const db = getFirestore(app); const clock = { now }; let token = 0;
  const adapter = new FirestoreModerationAdapter({ db, Timestamp, FieldPath, clock: () => clock.now, tokenFactory: () => `token-${++token}`, ...options });
  return { db, clock, adapter };
};
const put = async (db, entries) => { const batch = db.batch(); entries.forEach(([path, data]) => batch.set(db.doc(path), data)); await batch.commit(); };
const intake = (id, overrides = {}) => ({
  reporterUid: "reporter", targetKind: "post", targetCollection: "posts", targetId: "post", targetPath: "posts/post",
  reportedUserId: "author", reason: "harassment", createdAt: Timestamp.fromMillis(1), status: "queued", ...overrides
});
try {
  // Authoritative source data becomes the one bounded case snapshot and is hidden atomically with its intake.
  {
    const { db, adapter } = scenario();
    await put(db, [["posts/post", { authorId: "author", username: "Author", content: "evidence", imageData: "image", category: "Post", createdAt: Timestamp.fromMillis(1) }], ["reportIntakes/reporter_post_post", intake("r1")], ["reportIntakes/reporter-two_post_post", intake("r2", { reporterUid: "reporter-two", reason: "spam-scam" })], ["reportReceipts/reporter/post/post", { reporterUid: "reporter", targetKind: "post", targetId: "post", createdAt: Timestamp.fromMillis(1) }], ["reportReceipts/reporter-two/post/post", { reporterUid: "reporter-two", targetKind: "post", targetId: "post", createdAt: Timestamp.fromMillis(1) }]]);
    assert.deepEqual(await processModeration(adapter, { ownerId: "first", logger: { error() {} } }), { inspected: 2, processed: 2, failed: 0, skipped: 0, terminalIntakes: 0, terminalActions: 0, expiredRooms: 0, backfilled: 1, roomLifecycleMigrated: 0, roomLifecycleQuarantined: 0, roomLifecycleDeferred: 0, legacyRoomsCleaned: 0, legacyRoomsManualReview: 0 });
    const id = caseId("post", "post"); const caseSnapshot = await db.doc(`moderationCases/${id}`).get();
    assert.equal((await db.doc("posts/post").get()).data().moderationState, "hidden");
    assert.equal(caseSnapshot.data().reportCount, 2); assert.equal(caseSnapshot.data().snapshot.text, "evidence");
    assert.equal((await db.collection(`moderationCases/${id}/reports`).get()).size, 2);
    await db.doc(`moderationActions/${id}`).set({ action: "restore", requestedAt: Timestamp.fromMillis(2), requestedBy: "admin", status: "queued" });
    await processModeration(adapter, { ownerId: "restore", logger: { error() {} } });
    assert.equal((await db.doc("posts/post").get()).data().moderationState, "visible");
    assert.equal((await db.doc(`moderationCases/${id}`).get()).data().status, "restored");
    assert.equal((await db.collection("reportIntakes").get()).size, 0, "restore removes processed receipts so recurrence can be reported");
    assert.equal((await db.doc("reportReceipts/reporter/post/post").get()).exists, false, "restore removes the first reporter's private receipt");
    assert.equal((await db.doc("reportReceipts/reporter-two/post/post").get()).exists, false, "restore removes every matching private receipt");
    await db.doc("reportIntakes/reporter-three_post_post").set(intake("r3", { reporterUid: "reporter-three", reason: "other" }));
    await processModeration(adapter, { ownerId: "re-report", logger: { error() {} } });
    assert.equal((await db.doc("posts/post").get()).data().moderationState, "hidden", "a later report re-hides restored material");
    assert.equal((await db.doc(`moderationCases/${id}`).get()).data().status, "open", "a later report reopens restored evidence");
    await db.doc(`moderationActions/${id}`).set({ action: "deleteMaterial", requestedAt: Timestamp.fromMillis(3), requestedBy: "admin", status: "queued" });
    await put(db, [
      ["posts/post/comments/comment", { uid: "other", text: "comment" }], ["posts/post/comments/comment/replies/reply", { uid: "other", text: "reply" }],
      ["posts/post/reactions/reaction", { uid: "other" }], ["communityVotes/vote", { postId: "post", uid: "other" }], ["timelineVotes/vote", { postId: "post", uid: "other" }]
    ]);
    await processModeration(adapter, { ownerId: "delete", logger: { error() {} } });
    for (const path of ["posts/post", "posts/post/comments/comment", "posts/post/comments/comment/replies/reply", "posts/post/reactions/reaction", "communityVotes/vote", "timelineVotes/vote", `moderationCases/${id}`, `moderationActions/${id}`]) assert.equal((await db.doc(path).get()).exists, false, `${path} is permanently removed`);
    assert.deepEqual(await processModeration(adapter, { ownerId: "repeat", logger: { error() {} } }), { inspected: 0, processed: 0, failed: 0, skipped: 0, terminalIntakes: 0, terminalActions: 0, expiredRooms: 0, backfilled: 0, roomLifecycleMigrated: 0, roomLifecycleQuarantined: 0, roomLifecycleDeferred: 0, legacyRoomsCleaned: 0, legacyRoomsManualReview: 0 }, "repeated runs are idempotent");
  }

  // Failed or leased intake work defers cleanup; the retried intake snapshots evidence before expiry cleanup runs.
  {
    const { db, adapter, clock } = scenario();
    await put(db, [
      ["rooms/protected", { ownerId: "author", expiresAt: Timestamp.fromMillis(clock.now - 1) }],
      ["roomMessages/protected-message", { roomId: "protected", senderId: "author", tempName: "Temp", text: "authoritative evidence", expiresAt: Timestamp.fromMillis(clock.now - 1) }],
      ["reportIntakes/reporter_roomMessage_protected-message", intake("protected", { targetKind: "roomMessage", targetCollection: "roomMessages", targetId: "protected-message", targetPath: "roomMessages/protected-message" })]
    ]);
    const processClaimed = adapter.processClaimedIntake.bind(adapter);
    let failOnce = true;
    adapter.processClaimedIntake = async (...args) => {
      if (failOnce) { failOnce = false; throw new Error("transient"); }
      return processClaimed(...args);
    };
    const failed = await processModeration(adapter, { ownerId: "failed-evidence", logger: { error() {} } });
    assert.equal(failed.roomLifecycleDeferred, 1);
    assert.equal((await db.doc("rooms/protected").get()).exists, true);
    assert.equal((await db.doc("roomMessages/protected-message").get()).exists, true);
    await db.doc("reportIntakes/reporter_roomMessage_protected-message").update({ status: "processing", leaseExpiresAt: Timestamp.fromMillis(clock.now + 1_000), leaseOwner: "other", leaseToken: "other" });
    const leased = await processModeration(adapter, { ownerId: "leased-evidence", logger: { error() {} } });
    assert.equal(leased.roomLifecycleDeferred, 1);
    assert.equal((await db.doc("roomMessages/protected-message").get()).exists, true, "leased work retains authoritative source evidence");
    clock.now += 1_001;
    await processModeration(adapter, { ownerId: "retry-evidence", logger: { error() {} } });
    const caseSnapshot = await db.doc(`moderationCases/${caseId("roomMessage", "protected-message")}`).get();
    assert.equal(caseSnapshot.data().snapshot.text, "authoritative evidence");
    assert.equal((await db.doc("rooms/protected").get()).exists, false);
    assert.equal((await db.doc("roomMessages/protected-message").get()).exists, false);
  }

  // A deleted source never creates invented evidence, and an expired room message stays as expired evidence after room cleanup.
  {
    const { db, adapter, clock } = scenario();
    await put(db, [["reportIntakes/reporter_post_missing", intake("missing", { targetId: "missing", targetPath: "posts/missing" })], ["rooms/expired", { ownerId: "author", expiresAt: Timestamp.fromMillis(clock.now - 1) }], ["roomMessages/expired-message", { roomId: "expired", senderId: "author", tempName: "Temp", text: "expired body", expiresAt: Timestamp.fromMillis(clock.now - 1) }], ["roomMessages/expired-message/comments/nested", { uid: "other" }], ["roomMessages/expired-message/comments/nested/replies/deep", { uid: "other" }], ["roomMembers/expired-author", { roomId: "expired", uid: "author" }], ["reportIntakes/reporter_roomMessage_expired-message", intake("room", { targetKind: "roomMessage", targetCollection: "roomMessages", targetId: "expired-message", targetPath: "roomMessages/expired-message" })]]);
    await processModeration(adapter, { ownerId: "expiry", logger: { error() {} } });
    assert.equal((await db.doc("reportIntakes/reporter_post_missing").get()).data().result, "unavailable");
    assert.equal((await db.doc("moderationCases/post_missing").get()).exists, false);
    const roomCase = await db.doc(`moderationCases/${caseId("roomMessage", "expired-message")}`).get();
    assert.equal(roomCase.data().status, "expiredEvidence");
    assert.equal((await db.doc("rooms/expired").get()).exists, false); assert.equal((await db.doc("roomMessages/expired-message").get()).exists, false); assert.equal((await db.doc("roomMessages/expired-message/comments/nested").get()).exists, false); assert.equal((await db.doc("roomMessages/expired-message/comments/nested/replies/deep").get()).exists, false); assert.equal((await db.doc("roomMembers/expired-author").get()).exists, false);
  }

  // A case's canonical source metadata, text, and media evidence are established once and remain immutable across later reports.
  {
    const firstPhoto = "data:image/jpeg;base64,AAAA"; const laterPhoto = "data:image/jpeg;base64,BBBB";
    const { db, adapter } = scenario();
    await put(db, [["posts/immutable", { authorId: "author", username: "Original", content: "original evidence", imageData: firstPhoto, category: "Post" }], ["reportIntakes/reporter_post_immutable", intake("immutable", { targetId: "immutable", targetPath: "posts/immutable" })]]);
    await processModeration(adapter, { ownerId: "first-capture", logger: { error() {} } });
    await db.doc("posts/immutable").update({ username: "Changed", content: "changed later", imageData: laterPhoto });
    await db.doc("reportIntakes/reporter-two_post_immutable").set(intake("immutable-two", { reporterUid: "reporter-two", targetId: "immutable", targetPath: "posts/immutable", reason: "other" }));
    await processModeration(adapter, { ownerId: "later-report", logger: { error() {} } });
    const immutable = (await db.doc(`moderationCases/${caseId("post", "immutable")}`).get()).data();
    assert.equal(immutable.snapshot.text, "original evidence");
    assert.equal(immutable.snapshot.authorName, "Original");
    assert.equal(immutable.snapshot.media, undefined, "large media is not loaded with the active case queue");
    assert.deepEqual(immutable.snapshot.mediaKinds, ["postImage"]);
    assert.deepEqual(immutable.evidenceRetention, { boundary: "adminPermanentDelete", purgeAfter: null });
    assert.deepEqual((await db.doc(`moderationCases/${caseId("post", "immutable")}/evidence/media`).get()).data().items, [{ kind: "postImage", dataUrl: firstPhoto }]);
    assert.equal(immutable.reportCount, 2);
  }

  // Profile avatar and cover material are copied into protected bounded evidence.
  {
    const avatar = "data:image/png;base64,AAAA"; const cover = "data:image/webp;base64,BBBB";
    const { db, adapter } = scenario();
    await put(db, [["users/profile-target", { uid: "profile-target", username: "Target", profileImage: avatar, coverImage: cover }], ["reportIntakes/reporter_user_profile-target", intake("profile", { targetKind: "user", targetCollection: "users", targetId: "profile-target", targetPath: "users/profile-target", reportedUserId: "profile-target" })]]);
    await processModeration(adapter, { ownerId: "profile-evidence", logger: { error() {} } });
    const profileCaseId = caseId("user", "profile-target");
    assert.deepEqual((await db.doc(`moderationCases/${profileCaseId}`).get()).data().snapshot.mediaKinds, ["profileImage", "coverImage"]);
    assert.deepEqual((await db.doc(`moderationCases/${profileCaseId}/evidence/media`).get()).data().items, [{ kind: "profileImage", dataUrl: avatar }, { kind: "coverImage", dataUrl: cover }]);
  }

  // An abandoned lease is reclaimed and retry state is not terminal before the bounded attempt limit.
  {
    const { db, adapter, clock } = scenario();
    await put(db, [["posts/post", { authorId: "author", username: "Author", content: "recovered" }], ["reportIntakes/reporter_post_post", intake("recover", { status: "processing", attempts: 1, leaseOwner: "lost", leaseToken: "lost", leaseExpiresAt: Timestamp.fromMillis(clock.now - 1) })]]);
    const result = await processModeration(adapter, { ownerId: "recovery", logger: { error() {} } });
    assert.equal(result.processed, 1); assert.equal((await db.doc("reportIntakes/reporter_post_post").get()).data().status, "processed");
  }

  // Poisoned client intake is claimed, bounded, and retried rather than left queued forever.
  {
    const { db, adapter } = scenario();
    await put(db, [["posts/post", { authorId: "author", username: "Author", content: "safe" }], ["reportIntakes/not-canonical", intake("poison", { reason: "not-a-reason" })]]);
    const result = await processModeration(adapter, { ownerId: "poison", logger: { error() {} } });
    assert.equal(result.failed, 1); const poisoned = (await db.doc("reportIntakes/not-canonical").get()).data();
    assert.equal(poisoned.status, "failed"); assert.equal(poisoned.attempts, 1); assert.equal(poisoned.errorCode, "INVALID_INTAKE");
  }

  // The eighth poison failure is terminally settled into reviewable unavailable evidence.
  {
    const { db, adapter, clock } = scenario();
    await db.doc("reportIntakes/not-canonical").set(intake("poison", { reason: "not-a-reason", status: "failed", attempts: 7, nextAttemptAt: Timestamp.fromMillis(clock.now - 1) }));
    assert.equal((await processModeration(adapter, { ownerId: "eighth", logger: { error() {} } })).failed, 1);
    const exhausted = (await db.doc("reportIntakes/not-canonical").get()).data(); assert.equal(exhausted.attempts, 8); assert.equal(exhausted.status, "failed");
    clock.now += 120_000; const later = await processModeration(adapter, { ownerId: "ninth", logger: { error() {} } });
    assert.equal(later.terminalIntakes, 1); const terminal = (await db.doc("reportIntakes/not-canonical").get()).data();
    assert.equal(terminal.status, "terminal"); assert.equal(terminal.attempts, 8);
  }

  // Terminal poisoned receipts are retained as reviewable unavailable evidence and no longer block unrelated room cleanup.
  {
    const { db, adapter, clock } = scenario();
    await put(db, [
      ["reportIntakes/not-canonical", intake("poison", { reason: "not-a-reason", status: "failed", attempts: 8, nextAttemptAt: Timestamp.fromMillis(clock.now - 1) })],
      ["rooms/unrelated-expired", { ownerId: "author", expiresAt: Timestamp.fromMillis(clock.now - 1) }],
      ["roomMessages/unrelated-expired", { roomId: "unrelated-expired", senderId: "author", expiresAt: Timestamp.fromMillis(clock.now - 1) }]
    ]);
    const result = await processModeration(adapter, { ownerId: "terminal-intake", logger: { error() {} } });
    assert.equal(result.terminalIntakes, 1);
    assert.equal(result.roomLifecycleDeferred, 0);
    const receipt = (await db.doc("reportIntakes/not-canonical").get()).data();
    assert.equal(receipt.status, "terminal");
    assert.equal(receipt.result, "unavailable");
    const terminalCase = await db.doc(`moderationCases/${caseId("terminalIntake", "not-canonical")}`).get();
    assert.equal(terminalCase.data().status, "expiredEvidence");
    assert.equal(terminalCase.data().snapshot.kind, "unavailable");
    assert.equal((await db.collection(`moderationCases/${caseId("terminalIntake", "not-canonical")}/reports`).get()).size, 1, "terminal receipt retains a reviewable report disposition");
    assert.equal((await db.doc("rooms/unrelated-expired").get()).exists, false);
    assert.equal((await db.doc("roomMessages/unrelated-expired").get()).exists, false);
  }

  // Terminal actions preserve their failed metadata for an admin retry, but do not globally block room cleanup.
  {
    const { db, adapter, clock } = scenario(); const id = caseId("post", "terminal-action");
    await put(db, [
      [`moderationCases/${id}`, { targetKind: "post", targetCollection: "posts", targetId: "terminal-action", targetPath: "posts/terminal-action", reportedUserId: "author", snapshot: { kind: "post" }, status: "open" }],
      [`moderationActions/${id}`, { action: "restore", requestedAt: Timestamp.fromMillis(1), requestedBy: "admin", status: "failed", attempts: 8, errorCode: "PROCESSOR_FAILURE" }],
      ["rooms/action-unrelated-expired", { ownerId: "author", expiresAt: Timestamp.fromMillis(clock.now - 1) }],
      ["roomMessages/action-unrelated-expired", { roomId: "action-unrelated-expired", senderId: "author", expiresAt: Timestamp.fromMillis(clock.now - 1) }]
    ]);
    const result = await processModeration(adapter, { ownerId: "terminal-action", logger: { error() {} } });
    assert.equal(result.terminalActions, 1);
    const action = (await db.doc(`moderationActions/${id}`).get()).data();
    assert.equal(action.status, "terminal");
    assert.equal(action.errorCode, "PROCESSOR_FAILURE");
    assert.equal((await db.doc("rooms/action-unrelated-expired").get()).exists, false);
  }

  // A partial case deletion cannot leave an exhausted action permanently gating unrelated lifecycle work.
  {
    const { db, adapter, clock } = scenario(); const id = caseId("post", "missing-case-action");
    await put(db, [
      [`moderationActions/${id}`, { action: "restore", requestedAt: Timestamp.fromMillis(1), requestedBy: "original-admin", status: "failed", attempts: 8, errorCode: "PROCESSOR_FAILURE" }],
      ["rooms/missing-case-unrelated-expired", { ownerId: "author", expiresAt: Timestamp.fromMillis(clock.now - 1) }],
      ["roomMessages/missing-case-unrelated-expired", { roomId: "missing-case-unrelated-expired", senderId: "author", expiresAt: Timestamp.fromMillis(clock.now - 1) }]
    ]);
    const result = await processModeration(adapter, { ownerId: "missing-case-action", logger: { error() {} } });
    assert.equal(result.terminalActions, 1);
    const action = (await db.doc(`moderationActions/${id}`).get()).data();
    assert.deepEqual({ action: action.action, requestedBy: action.requestedBy, attempts: action.attempts, status: action.status, result: action.result, errorCode: action.errorCode }, {
      action: "restore", requestedBy: "original-admin", attempts: 8, status: "terminal", result: "missing-case", errorCode: "MISSING_CASE"
    });
    assert.equal((await db.doc("rooms/missing-case-unrelated-expired").get()).exists, false);
    assert.equal((await db.doc("roomMessages/missing-case-unrelated-expired").get()).exists, false);
  }

  // Restoring expired evidence never revives the source or discards the case; its action records a non-success outcome.
  {
    const { db, adapter, clock } = scenario(); const id = caseId("roomMessage", "expired");
    await put(db, [["roomMessages/expired", { roomId: "room", senderId: "author", text: "evidence", expiresAt: Timestamp.fromMillis(clock.now - 1), moderationState: "hidden" }], [`moderationCases/${id}`, { targetKind: "roomMessage", targetCollection: "roomMessages", targetId: "expired", targetPath: "roomMessages/expired", reportedUserId: "author", snapshot: { kind: "roomMessage" }, status: "expiredEvidence" }], [`moderationActions/${id}`, { action: "restore", requestedAt: Timestamp.fromMillis(1), requestedBy: "admin", status: "queued" }]]);
    assert.equal((await processModeration(adapter, { ownerId: "expired-restore", logger: { error() {} } })).failed, 1);
    assert.equal((await db.doc("roomMessages/expired").get()).data().moderationState, "hidden"); assert.equal((await db.doc(`moderationCases/${id}`).get()).data().status, "expiredEvidence"); assert.equal((await db.doc(`moderationActions/${id}`).get()).data().status, "failed");
  }


  // Room cleanup has one transactional winner; rerunning after deletion does not add a second count.
  {
    const { db, adapter, clock } = scenario();
    await put(db, [["rooms/race", { expiresAt: Timestamp.fromMillis(clock.now - 1) }], ["roomMessages/race-message", { roomId: "race" }], ["roomMembers/race-member", { roomId: "race" }]]);
    const outcomes = await Promise.all([adapter.cleanupExpiredRoom("race"), adapter.cleanupExpiredRoom("race")]);
    assert.deepEqual(outcomes.sort(), [false, true]); assert.equal((await db.doc("rooms/race").get()).exists, false);
    assert.equal((await processModeration(adapter, { ownerId: "room-repeat", logger: { error() {} } })).expiredRooms, 0);
  }

  // An intake committed after the run's initial scan but before cleanup is drained behind the room-closing fence.
  {
    let inserted = false; let db;
    const setup = scenario(2_000_000_000_000, { beforeRoomCleanupClaim: async ({ roomId }) => {
      if (inserted || roomId !== "late-intake") return;
      inserted = true;
      await db.doc("reportIntakes/reporter_roomMessage_late-message").set(intake("late", { targetKind: "roomMessage", targetCollection: "roomMessages", targetId: "late-message", targetPath: "roomMessages/late-message" }));
    } });
    db = setup.db; const { adapter, clock } = setup;
    await put(db, [["rooms/late-intake", { ownerId: "author", createdAt: Timestamp.fromMillis(clock.now - 86_400_001), expiresAt: Timestamp.fromMillis(clock.now - 1) }], ["roomMessages/late-message", { roomId: "late-intake", senderId: "author", tempName: "Temp", text: "late evidence", createdAt: Timestamp.fromMillis(clock.now - 1), expiresAt: Timestamp.fromMillis(clock.now - 1) }]]);
    const result = await processModeration(adapter, { ownerId: "late-race", logger: { error() {} } });
    assert.equal(result.expiredRooms, 1);
    assert.equal((await db.doc("rooms/late-intake").get()).exists, false);
    const evidence = (await db.doc(`moderationCases/${caseId("roomMessage", "late-message")}`).get()).data();
    assert.equal(evidence.snapshot.text, "late evidence");
    assert.equal(evidence.status, "expiredEvidence");
    assert.equal((await db.doc("reportIntakes/reporter_roomMessage_late-message").get()).data().status, "processed");
  }

  // A failed individual-message drain reopens the surviving room even if the message then disappears; stale leases are repaired by the scheduled processor.
  {
    const { db, adapter, clock } = scenario();
    await put(db, [
      ["rooms/surviving-room", { ownerId: "other", createdAt: Timestamp.fromMillis(clock.now), expiresAt: Timestamp.fromMillis(clock.now + 86_400_000), moderationState: "visible" }],
      ["roomMessages/drain-failure", { roomId: "surviving-room", senderId: "author", text: "pending", expiresAt: Timestamp.fromMillis(clock.now + 86_400_000) }],
      ["reportIntakes/reporter_roomMessage_drain-failure", { ...intake("drain-failure", { targetKind: "roomMessage", targetCollection: "roomMessages", targetId: "drain-failure", targetPath: "roomMessages/drain-failure" }), status: "processing", attempts: 1, leaseToken: "other", leaseOwner: "other", leaseExpiresAt: Timestamp.fromMillis(clock.now + 60_000) }]
    ]);
    await assert.rejects(() => adapter.cleanupRoomMessageForTrustedDeletion("drain-failure"), (error) => error.code === "unsettled-intake");
    assert.equal((await db.doc("rooms/surviving-room").get()).data().cleanupState, "open", "the failure path releases its room-closing lease");
    await db.doc("roomMessages/drain-failure").delete();
    await db.doc("reportIntakes/reporter_roomMessage_drain-failure").delete();
    await put(db, [["rooms/stale-closing", {
      ownerId: "other", createdAt: Timestamp.fromMillis(clock.now), expiresAt: Timestamp.fromMillis(clock.now + 86_400_000),
      cleanupState: "closing", cleanupLeaseToken: "lost", cleanupLeaseExpiresAt: Timestamp.fromMillis(clock.now - 1)
    }], ["rooms/actively-leased", {
      ownerId: "other", createdAt: Timestamp.fromMillis(clock.now), expiresAt: Timestamp.fromMillis(clock.now + 86_400_000),
      cleanupState: "closing", cleanupLeaseToken: "active", cleanupLeaseExpiresAt: Timestamp.fromMillis(clock.now + 60_000)
    }], ["rooms/expired-deletion", {
      ownerId: "other", createdAt: Timestamp.fromMillis(clock.now - 86_400_000), expiresAt: Timestamp.fromMillis(clock.now - 1),
      cleanupState: "closing", cleanupLeaseToken: "expired", cleanupLeaseExpiresAt: Timestamp.fromMillis(clock.now - 1)
    }]]);
    assert.equal(await adapter.recoverStaleClosingRoom("actively-leased"), false, "direct recovery respects a live lease");
    assert.equal(await adapter.recoverStaleClosingRoom("expired-deletion"), false, "direct recovery preserves the deletion state for expired rooms");
    await processModeration(adapter, { ownerId: "scheduled-room-repair", logger: { error() {} } });
    const repaired = (await db.doc("rooms/stale-closing").get()).data();
    assert.equal(repaired.cleanupState, "open");
    assert.equal(repaired.cleanupRecoveredAt.toMillis(), clock.now);
    assert.equal((await db.doc("rooms/actively-leased").get()).data().cleanupState, "closing", "an active room-deletion lease is never reopened");
    assert.equal((await db.doc("rooms/expired-deletion").get()).exists, false, "an expired room remains on the deletion path instead of being reopened");
  }

  // User-profile deletion stays in the dedicated administrator-deletion queue: moderation evidence is retained.
  {
    const { db, adapter } = scenario(); const id = caseId("user", "target");
    await put(db, [["users/target", { uid: "target", username: "Target" }], [`moderationCases/${id}`, { targetKind: "user", targetCollection: "users", targetId: "target", targetPath: "users/target", reportedUserId: "target", snapshot: { kind: "user" }, status: "open" }], [`moderationActions/${id}`, { action: "deleteMaterial", requestedAt: Timestamp.fromMillis(1), requestedBy: "admin", status: "queued" }]]);
    const result = await processModeration(adapter, { ownerId: "user-delete", logger: { error() {} } });
    assert.equal(result.failed, 1); assert.equal((await db.doc("users/target").get()).exists, true);
    assert.equal((await db.doc(`moderationCases/${id}`).get()).exists, true); assert.equal((await db.doc(`moderationActions/${id}`).get()).data().status, "failed");
  }

  // A restore action for a case already permanently removed is a terminal success, not a false lease loss.
  {
    const { db, adapter } = scenario();
    await db.doc("moderationActions/post_missing-case").set({ action: "restore", requestedAt: Timestamp.fromMillis(1), requestedBy: "admin", status: "queued" });
    const result = await processModeration(adapter, { ownerId: "missing-case", logger: { error() {} } });
    assert.equal(result.processed, 1); assert.equal((await db.doc("moderationActions/post_missing-case").get()).exists, false);
  }

  // A recovered partial community cascade removes descendants and votes before the parent on the next lease.
  {
    const { db, adapter, clock } = scenario(); const id = caseId("communityPost", "community");
    await put(db, [["communityPosts/community", { authorId: "author", username: "Author", content: "material" }], ["communityPosts/community/comments/comment", { uid: "other" }], ["communityPosts/community/comments/comment/replies/reply", { uid: "other" }], ["communityPosts/community/reactions/reaction", { uid: "other" }], ["communityVotes/community-vote", { postId: "community", uid: "other" }], ["timelineVotes/community-vote", { postId: "community", uid: "other" }], [`moderationCases/${id}`, { targetKind: "communityPost", targetCollection: "communityPosts", targetId: "community", targetPath: "communityPosts/community", reportedUserId: "author", snapshot: { kind: "communityPost" }, status: "deleteQueued" }], [`moderationActions/${id}`, { action: "deleteMaterial", requestedAt: Timestamp.fromMillis(1), requestedBy: "admin", status: "processing", attempts: 1, leaseOwner: "lost", leaseToken: "lost", leaseExpiresAt: Timestamp.fromMillis(clock.now - 1) }]]);
    assert.equal((await processModeration(adapter, { ownerId: "cascade-recovery", logger: { error() {} } })).processed, 1);
    for (const path of ["communityPosts/community", "communityPosts/community/comments/comment", "communityPosts/community/comments/comment/replies/reply", "communityPosts/community/reactions/reaction", "communityVotes/community-vote", "timelineVotes/community-vote", `moderationCases/${id}`]) assert.equal((await db.doc(path).get()).exists, false, `${path} is removed after recovery`);
  }

  // A real mid-cascade failure retains the case, then an expired lease reclaims and completes idempotently.
  {
    let failOnce = true;
    const { db, adapter, clock } = scenario(2_000_000_000_000, { beforeLeasedDelete: (refs) => {
      if (failOnce && refs.some((ref) => ref.path.endsWith("comments/b"))) { failOnce = false; throw Object.assign(new Error("injected"), { code: "action-limit" }); }
    } }); const id = caseId("post", "partial");
    await put(db, [["posts/partial", { authorId: "author", username: "Author", content: "material" }], ["posts/partial/comments/a", { uid: "other" }], ["posts/partial/comments/b", { uid: "other" }], [`moderationCases/${id}`, { targetKind: "post", targetCollection: "posts", targetId: "partial", targetPath: "posts/partial", reportedUserId: "author", snapshot: { kind: "post" }, status: "open" }], [`moderationActions/${id}`, { action: "deleteMaterial", requestedAt: Timestamp.fromMillis(1), requestedBy: "admin", status: "queued" }]]);
    assert.equal((await processModeration(adapter, { ownerId: "partial-fail", logger: { error() {} } })).failed, 1);
    assert.equal((await db.doc("posts/partial/comments/a").get()).exists, false); assert.equal((await db.doc("posts/partial/comments/b").get()).exists, true); assert.equal((await db.doc(`moderationCases/${id}`).get()).exists, true);
    clock.now += 120_000; const recovery = new FirestoreModerationAdapter({ db, Timestamp, FieldPath, clock: () => clock.now, tokenFactory: () => "recovered" });
    assert.equal((await processModeration(recovery, { ownerId: "partial-recover", logger: { error() {} } })).processed, 1);
    for (const path of ["posts/partial", "posts/partial/comments/b", `moderationCases/${id}`, `moderationActions/${id}`]) assert.equal((await db.doc(path).get()).exists, false, `${path} completes after reclaim`);
  }

  // A concurrent valid report records its receipt but cannot downgrade a pending material deletion.
  {
    const { db, adapter, clock } = scenario(); const id = caseId("post", "pending");
    await put(db, [["posts/pending", { authorId: "author", username: "Author", content: "material" }], [`moderationCases/${id}`, { targetKind: "post", targetCollection: "posts", targetId: "pending", targetPath: "posts/pending", reportedUserId: "author", snapshot: { kind: "post" }, status: "deleteQueued", reportCount: 0, reasonTotals: {} }], [`moderationActions/${id}`, { action: "deleteMaterial", requestedAt: Timestamp.fromMillis(1), requestedBy: "admin", status: "processing", attempts: 1, leaseOwner: "other", leaseToken: "other", leaseExpiresAt: Timestamp.fromMillis(clock.now + 1_000) }], ["reportIntakes/reporter_post_pending", intake("pending", { targetId: "pending", targetPath: "posts/pending" })]]);
    const intakeResult = await processModeration(adapter, { ownerId: "intake-during-delete", logger: { error() {} } });
    assert.equal(intakeResult.processed, 1); assert.equal((await db.doc(`moderationCases/${id}`).get()).data().status, "deleteQueued"); assert.equal((await db.collection(`moderationCases/${id}/reports`).get()).size, 1);
  }

  // Intake scanning is paginated at the fixed page size without losing later queued entries.
  {
    const { db, adapter } = scenario(); const entries = [["posts/post", { authorId: "author", username: "Author", content: "paged" }]];
    for (let index = 0; index < 101; index += 1) entries.push([`reportIntakes/reporter-${index}_post_post`, intake("page", { reporterUid: `reporter-${index}` })]);
    await put(db, entries); const result = await processModeration(adapter, { ownerId: "pages", logger: { error() {} } });
    assert.equal(result.processed, 101); assert.equal((await db.doc(`moderationCases/${caseId("post", "post")}`).get()).data().reportCount, 101);
  }
  console.log("Moderation Firestore integration passed");
} finally { await Promise.all(apps.map((app) => deleteApp(app))); }
