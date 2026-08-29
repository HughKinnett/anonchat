import { LEGACY_ROOM_GRACE_MS, LEASE_MS, MAX_ATTEMPTS, PAGE_SIZE, caseId, fixedErrorCode, isLeaseEligible, isTerminalModerationRecord, isValidModerationIntake, restoreOutcome, retryDelayMillis, snapshotForTarget, timestampToMillis } from "./moderation-processor-policy.mjs";

const coded = (code) => Object.assign(new Error(code), { code });
const targetAuthor = (kind, data) => kind === "roomMessage" ? data.senderId : kind === "user" ? data.uid : data.authorId;
const safeRoomId = (value) => typeof value === "string" && value.length > 0 && !value.includes("/") && value !== "." && value !== "..";
const protectedEvidence = (snapshot) => {
  const { media = [], ...boundedSnapshot } = snapshot;
  return {
    snapshot: media.length ? { ...boundedSnapshot, mediaKinds: media.map((item) => item.kind) } : boundedSnapshot,
    media
  };
};
const retentionBoundary = Object.freeze({ boundary: "adminPermanentDelete", purgeAfter: null });

export class FirestoreModerationAdapter {
  constructor({ db, Timestamp, FieldPath, clock = () => Date.now(), tokenFactory = () => crypto.randomUUID(), beforeLeasedDelete, beforeBackfillPage, beforeRoomLifecyclePage, beforeRoomCleanupClaim, beforeRoomMessageCleanupClaim }) {
    this.db = db; this.Timestamp = Timestamp; this.FieldPath = FieldPath; this.clock = clock; this.tokenFactory = tokenFactory; this.beforeLeasedDelete = beforeLeasedDelete; this.beforeBackfillPage = beforeBackfillPage; this.beforeRoomLifecyclePage = beforeRoomLifecyclePage; this.beforeRoomCleanupClaim = beforeRoomCleanupClaim; this.beforeRoomMessageCleanupClaim = beforeRoomMessageCleanupClaim;
  }
  now() { return this.clock(); }
  timestamp(value) { return this.Timestamp.fromMillis(value); }
  intakeRef(id) { return this.db.collection("reportIntakes").doc(id); }
  actionRef(id) { return this.db.collection("moderationActions").doc(id); }
  backfillRef() { return this.db.doc("system/moderationStateBackfill"); }
  roomLifecycleBackfillRef() { return this.db.doc("system/roomLifecycleBackfill"); }
  legacyRoomQueueRef(id) { return this.db.collection("legacyRoomQuarantine").doc(id); }
  legacyRoomActionRef(id) { return this.db.collection("legacyRoomActions").doc(id); }
  caseRef(id) { return this.db.collection("moderationCases").doc(id); }
  async heartbeat(status, errorCode) {
    const data = { status, updatedAt: this.timestamp(this.now()) }; if (errorCode) data.errorCode = errorCode;
    await this.db.doc("system/moderationProcessor").set(data);
  }
  async backfillModerationState() {
    if ((await this.backfillRef().get()).data()?.status === "completed") return { migrated: 0 };
    let migrated = 0;
    for (const collectionName of ["posts", "communityPosts"]) {
      let cursor;
      while (true) {
        let query = this.db.collection(collectionName).orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
        if (cursor) query = query.startAfter(cursor);
        const page = await query.get();
        if (page.empty) break;
        await this.beforeBackfillPage?.({ collection: collectionName, count: page.size });
        migrated += await this.db.runTransaction(async (transaction) => {
          const snapshots = await Promise.all(page.docs.map((entry) => transaction.get(entry.ref)));
          let changed = 0;
          snapshots.forEach((snapshot) => {
            if (snapshot.exists && !Object.hasOwn(snapshot.data(), "moderationState")) {
              transaction.set(snapshot.ref, { moderationState: "visible" }, { merge: true });
              changed += 1;
            }
          });
          return changed;
        });
        cursor = page.docs.at(-1).id;
      }
    }
    await this.db.runTransaction(async (transaction) => {
      const marker = await transaction.get(this.backfillRef());
      if (marker.data()?.status !== "completed") {
        transaction.set(this.backfillRef(), { status: "completed", completedAt: this.timestamp(this.now()) });
      }
    });
    return { migrated };
  }
  async backfillRoomLifecycle() {
    const existingMarker = (await this.roomLifecycleBackfillRef().get()).data();
    if (existingMarker?.status === "completed" && existingMarker.quarantinePolicyVersion === 1) return { migrated: 0, quarantined: 0 };
    let migrated = 0;
    let quarantined = 0;
    let cursor;
    while (true) {
      let query = this.db.collection("rooms").orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      await this.beforeRoomLifecyclePage?.({ collection: "rooms", count: page.size });
      const outcome = await this.db.runTransaction(async (transaction) => {
        const snapshots = await Promise.all(page.docs.map((entry) => transaction.get(entry.ref)));
        const queues = await Promise.all(page.docs.map((entry) => transaction.get(this.legacyRoomQueueRef(entry.id))));
        let changed = 0; let quarantinedCount = 0;
        snapshots.forEach((snapshot, index) => {
          if (!snapshot.exists) return;
          const data = snapshot.data();
          const expiry = timestampToMillis(data.expiresAt);
          const createdAt = timestampToMillis(data.createdAt);
          const updates = {};
          if (!Number.isFinite(createdAt)) {
            if (data.lifecycleMigrationState !== "missing-created-at") {
              transaction.set(snapshot.ref, { lifecycleMigrationState: "missing-created-at", lifecycleMigrationUpdatedAt: this.timestamp(this.now()) }, { merge: true });
              changed += 1;
            }
            if (!queues[index].exists) transaction.set(queues[index].ref, {
              roomId: snapshot.id, status: "quarantined", reason: "missing-or-invalid-created-at",
              policy: "cleanup-after-grace", quarantinedAt: this.timestamp(this.now()),
              graceExpiresAt: this.timestamp(this.now() + LEGACY_ROOM_GRACE_MS), attempts: 0
            });
            quarantinedCount += 1;
            return;
          }
          if (!Number.isFinite(expiry)) updates.expiresAt = this.timestamp(createdAt + 24 * 60 * 60 * 1000);
          if (!Object.hasOwn(data, "moderationState")) updates.moderationState = "visible";
          if (Object.keys(updates).length) { transaction.set(snapshot.ref, updates, { merge: true }); changed += 1; }
        });
        return { changed, quarantined: quarantinedCount };
      });
      migrated += outcome.changed; quarantined += outcome.quarantined;
      cursor = page.docs.at(-1).id;
    }
    cursor = undefined;
    while (true) {
      let query = this.db.collection("roomMessages").orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      await this.beforeRoomLifecyclePage?.({ collection: "roomMessages", count: page.size });
      const outcome = await this.db.runTransaction(async (transaction) => {
        const snapshots = await Promise.all(page.docs.map((entry) => transaction.get(entry.ref)));
        const rooms = await Promise.all(snapshots.map((snapshot) => snapshot.exists && safeRoomId(snapshot.data().roomId)
          ? transaction.get(this.db.collection("rooms").doc(snapshot.data().roomId))
          : null));
        let changed = 0; let quarantinedCount = 0;
        for (const [index, snapshot] of snapshots.entries()) {
          if (!snapshot.exists) continue;
          const data = snapshot.data();
          const room = rooms[index];
          const messageExpiry = timestampToMillis(data.expiresAt);
          if (!room) { transaction.delete(snapshot.ref); changed += 1; continue; }
          const roomExpiry = room.exists ? timestampToMillis(room.data().expiresAt) : Number.NaN;
          if (!room.exists) {
            transaction.delete(snapshot.ref); changed += 1;
            continue;
          }
          const roomCreatedAt = timestampToMillis(room.data().createdAt);
          if (!Number.isFinite(roomExpiry) || !Number.isFinite(roomCreatedAt)) {
            if (data.lifecycleMigrationState !== "parent-invalid-timestamp") {
              transaction.set(snapshot.ref, { lifecycleMigrationState: "parent-invalid-timestamp", lifecycleMigrationUpdatedAt: this.timestamp(this.now()) }, { merge: true });
              changed += 1;
            }
            quarantinedCount += 1;
            continue;
          }
          if (roomExpiry <= this.now()) {
            if (!Number.isFinite(messageExpiry)) { transaction.delete(snapshot.ref); changed += 1; }
            continue;
          }
          const updates = {};
          if (messageExpiry !== roomExpiry) updates.expiresAt = room.data().expiresAt;
          if (!Number.isFinite(timestampToMillis(data.createdAt))) updates.createdAt = room.data().createdAt;
          if (!Object.hasOwn(data, "moderationState")) updates.moderationState = "visible";
          if (Object.keys(updates).length) { transaction.set(snapshot.ref, updates, { merge: true }); changed += 1; }
        }
        return { changed, quarantined: quarantinedCount };
      });
      migrated += outcome.changed; quarantined += outcome.quarantined;
      cursor = page.docs.at(-1).id;
    }
    await this.db.runTransaction(async (transaction) => {
      const marker = await transaction.get(this.roomLifecycleBackfillRef());
      if (marker.data()?.status !== "completed" || marker.data()?.quarantinePolicyVersion !== 1) {
        transaction.set(this.roomLifecycleBackfillRef(), { status: "completed", quarantinePolicyVersion: 1, migrated, quarantined, completedAt: this.timestamp(this.now()) });
      }
    });
    return { migrated, quarantined };
  }
  async scanIntakesPage(cursor) {
    let query = this.db.collection("reportIntakes").where("status", "in", ["queued", "failed", "processing"])
      .orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get(); return { items: snapshot.docs.map((doc) => ({ id: doc.id })), nextCursor: snapshot.docs.at(-1)?.id };
  }
  async scanActionsPage(cursor) {
    let query = this.db.collection("moderationActions").where("status", "in", ["queued", "failed", "processing"])
      .orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get(); return { items: snapshot.docs.map((doc) => ({ id: doc.id })), nextCursor: snapshot.docs.at(-1)?.id };
  }
  async scanLegacyRoomQueuePage(cursor) {
    let query = this.db.collection("legacyRoomQuarantine").where("status", "in", ["quarantined", "failed", "processing"])
      .orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get(); return { items: snapshot.docs.map((doc) => ({ id: doc.id })), nextCursor: snapshot.docs.at(-1)?.id };
  }
  async scanLegacyRoomActionsPage(cursor) {
    let query = this.db.collection("legacyRoomActions").where("status", "==", "queued")
      .orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    return { items: snapshot.docs.map((doc) => ({ id: doc.id })), nextCursor: snapshot.docs.at(-1)?.id };
  }
  async processLegacyRoomAction(id) {
    return this.db.runTransaction(async (transaction) => {
      const actionRef = this.legacyRoomActionRef(id); const actionSnapshot = await transaction.get(actionRef);
      if (!actionSnapshot.exists || actionSnapshot.data().status !== "queued") return false;
      const action = actionSnapshot.data();
      if (!safeRoomId(action.roomId) || !["retryCleanup", "approveCleanup", "release"].includes(action.action)) throw coded("action-invalid");
      const queueRef = this.legacyRoomQueueRef(action.roomId); const queueSnapshot = await transaction.get(queueRef);
      if (!queueSnapshot.exists || queueSnapshot.data().status !== "manualReview") {
        transaction.update(actionRef, { status: "completed", result: "superseded", completedAt: this.timestamp(this.now()) });
        return false;
      }
      const roomRef = this.db.collection("rooms").doc(action.roomId); const roomSnapshot = await transaction.get(roomRef);
      if (action.action === "release") {
        transaction.update(queueRef, { status: "released", resolution: "admin-release", resolvedAt: this.timestamp(this.now()), resolvedBy: action.requestedBy });
        if (roomSnapshot.exists) transaction.set(roomRef, { cleanupState: "released", lifecycleMigrationState: "released", lifecycleMigrationUpdatedAt: this.timestamp(this.now()) }, { merge: true });
      } else {
        transaction.update(queueRef, {
          status: "quarantined", policy: action.action === "approveCleanup" ? "admin-approved-cleanup" : "cleanup-after-grace",
          graceExpiresAt: this.timestamp(this.now()), attempts: 0, lastReviewedAt: this.timestamp(this.now()), lastReviewedBy: action.requestedBy
        });
      }
      transaction.update(actionRef, { status: "completed", completedAt: this.timestamp(this.now()) });
      return true;
    });
  }
  async scanExpiredRoomsPage(cursor, runCutoff = this.now()) {
    let query = this.db.collection("rooms").where("expiresAt", "<=", this.timestamp(runCutoff))
      .orderBy("expiresAt").orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor.expiresAt, cursor.id);
    const snapshot = await query.get();
    const last = snapshot.docs.at(-1); return { items: snapshot.docs.map((doc) => ({ id: doc.id, expiresAt: doc.data().expiresAt })), nextCursor: last ? { id: last.id, expiresAt: last.data().expiresAt } : undefined };
  }
  async scanStaleClosingRoomsPage(cursor) {
    let query = this.db.collection("rooms").where("cleanupState", "==", "closing")
      .where("cleanupLeaseExpiresAt", "<=", this.timestamp(this.now()))
      .orderBy("cleanupLeaseExpiresAt").orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor.cleanupLeaseExpiresAt, cursor.id);
    const snapshot = await query.get(); const last = snapshot.docs.at(-1);
    return {
      items: snapshot.docs.map((entry) => ({ id: entry.id })),
      nextCursor: last ? { id: last.id, cleanupLeaseExpiresAt: last.data().cleanupLeaseExpiresAt } : undefined
    };
  }
  async recoverStaleClosingRoom(id) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.db.collection("rooms").doc(id); const snapshot = await transaction.get(reference);
      if (!snapshot.exists || snapshot.data().cleanupState !== "closing"
        || timestampToMillis(snapshot.data().cleanupLeaseExpiresAt) > this.now()
        || timestampToMillis(snapshot.data().expiresAt) <= this.now()) return false;
      transaction.set(reference, {
        cleanupState: "open", cleanupLeaseOwner: "", cleanupLeaseToken: "", cleanupLeaseExpiresAt: this.timestamp(this.now()),
        cleanupRecoveredAt: this.timestamp(this.now())
      }, { merge: true });
      return true;
    });
  }
  async claimIntake(id, ownerId) { return this.#claim(this.intakeRef(id), id, ownerId, "intake"); }
  async claimAction(id, ownerId) { return this.#claim(this.actionRef(id), id, ownerId, "action"); }
  async claimLegacyRoom(id, ownerId, runCutoff) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.legacyRoomQueueRef(id); const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return null;
      const data = snapshot.data();
      const eligible = (data.status === "quarantined" && timestampToMillis(data.graceExpiresAt) <= runCutoff)
        || (data.status === "failed" && timestampToMillis(data.nextAttemptAt) <= runCutoff)
        || (data.status === "processing" && timestampToMillis(data.leaseExpiresAt) <= this.now());
      if (!eligible || (data.attempts ?? 0) >= MAX_ATTEMPTS || !safeRoomId(data.roomId)) return null;
      const token = this.tokenFactory();
      transaction.update(reference, { status: "processing", attempts: (data.attempts ?? 0) + 1, leaseOwner: ownerId, leaseToken: token, leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
      return { id, roomId: data.roomId, token };
    });
  }
  async settleTerminalLegacyRoom(id) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.legacyRoomQueueRef(id); const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return false;
      const data = snapshot.data();
      const exhausted = (data.status === "failed" || (data.status === "processing" && timestampToMillis(data.leaseExpiresAt) <= this.now()))
        && Number.isInteger(data.attempts) && data.attempts >= MAX_ATTEMPTS;
      if (!exhausted) return false;
      transaction.update(reference, { status: "manualReview", terminalPolicy: "manual-review", terminalAt: this.timestamp(this.now()) });
      return true;
    });
  }
  async settleTerminalIntake(id) {
    return this.db.runTransaction(async (transaction) => {
      const intakeRef = this.intakeRef(id); const intakeSnapshot = await transaction.get(intakeRef);
      if (!intakeSnapshot.exists || !isTerminalModerationRecord(intakeSnapshot.data())) return false;
      const intake = intakeSnapshot.data(); const valid = isValidModerationIntake(id, intake);
      const sourceRef = valid ? this.db.collection(intake.targetCollection).doc(intake.targetId) : null;
      const source = sourceRef ? await transaction.get(sourceRef) : null;
      const sourceData = source?.exists ? source.data() : null;
      const captured = valid && sourceData && targetAuthor(intake.targetKind, sourceData) === intake.reportedUserId
        ? snapshotForTarget(intake.targetKind, sourceData) : { kind: "unavailable" };
      const evidence = protectedEvidence(captured);
      const terminalCaseId = caseId("terminalIntake", id); const terminalCase = this.caseRef(terminalCaseId);
      const terminalReport = terminalCase.collection("reports").doc(id);
      const safe = (value) => typeof value === "string" ? value.slice(0, 160) : "";
      transaction.set(terminalCase, {
        targetKind: valid ? intake.targetKind : "terminalIntake",
        targetCollection: valid ? intake.targetCollection : safe(intake.targetCollection),
        targetId: valid ? intake.targetId : id,
        targetPath: valid ? intake.targetPath : "",
        reportedUserId: valid ? intake.reportedUserId : safe(intake.reportedUserId),
        snapshot: evidence.snapshot, evidenceRetention: retentionBoundary, status: "expiredEvidence", terminalDisposition: "attempt-limit",
        intakeMetadata: { targetKind: safe(intake.targetKind), targetCollection: safe(intake.targetCollection), targetId: safe(intake.targetId), targetPath: safe(intake.targetPath), reason: safe(intake.reason) },
        reportCount: 1, reasonTotals: {}, createdAt: this.timestamp(this.now()), updatedAt: this.timestamp(this.now())
      }, { merge: true });
      if (evidence.media.length) transaction.set(terminalCase.collection("evidence").doc("media"), { items: evidence.media, createdAt: this.timestamp(this.now()), retention: retentionBoundary });
      transaction.set(terminalReport, { reporterUid: safe(intake.reporterUid), reason: safe(intake.reason), createdAt: Number.isFinite(timestampToMillis(intake.createdAt)) ? intake.createdAt : this.timestamp(this.now()), disposition: "terminal" }, { merge: true });
      transaction.update(intakeRef, { status: "terminal", result: "unavailable", terminalCaseId, terminalAt: this.timestamp(this.now()) });
      return true;
    });
  }
  async settleTerminalAction(id) {
    return this.db.runTransaction(async (transaction) => {
      const [action, moderationCase] = await Promise.all([transaction.get(this.actionRef(id)), transaction.get(this.caseRef(id))]);
      if (!action.exists || !isTerminalModerationRecord(action.data())) return false;
      if (!moderationCase.exists) {
        transaction.update(action.ref, { status: "terminal", result: "missing-case", errorCode: "MISSING_CASE", terminalSettledAt: this.timestamp(this.now()) });
        return true;
      }
      transaction.update(action.ref, { status: "terminal", terminalSettledAt: this.timestamp(this.now()) });
      return true;
    });
  }
  async #claim(reference, id, ownerId, kind) {
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference); if (!snapshot.exists) return null;
      const data = snapshot.data(); if (!isLeaseEligible(data, this.now()) || (data.attempts ?? 0) >= MAX_ATTEMPTS) return null;
      if (kind === "action" && !["restore", "deleteMaterial"].includes(data.action)) throw coded("action-invalid");
      const token = this.tokenFactory(); transaction.update(reference, {
        status: "processing", attempts: (Number.isInteger(data.attempts) ? data.attempts : 0) + 1,
        leaseOwner: ownerId, leaseToken: token, leaseExpiresAt: this.timestamp(this.now() + LEASE_MS)
      }); return { id, token };
    });
  }
  async #assertLease(transaction, reference, token) {
    const snapshot = await transaction.get(reference); if (!snapshot.exists) throw coded("lease-lost");
    const data = snapshot.data();
    if (data.status !== "processing" || data.leaseToken !== token || timestampToMillis(data.leaseExpiresAt) <= this.now()) throw coded("lease-lost");
    return data;
  }
  async renewIntake(id, token) { await this.#renew(this.intakeRef(id), token); }
  async renewAction(id, token) { await this.#renew(this.actionRef(id), token); }
  async #renew(reference, token) { await this.db.runTransaction(async (transaction) => {
    await this.#assertLease(transaction, reference, token); transaction.update(reference, { leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
  }); }
  async processClaimedIntake(id, token) {
    await this.db.runTransaction(async (transaction) => {
      const intakeRef = this.intakeRef(id); const intake = await this.#assertLease(transaction, intakeRef, token);
      if (!isValidModerationIntake(id, intake)) throw coded("invalid-intake");
      const idValue = caseId(intake.targetKind, intake.targetId); const caseRef = this.caseRef(idValue); const actionRef = this.actionRef(idValue);
      const sourceRef = this.db.collection(intake.targetCollection).doc(intake.targetId); const sourceSnapshot = await transaction.get(sourceRef);
      if (!sourceSnapshot.exists) {
        const [currentCase, actionSnapshot] = await Promise.all([transaction.get(caseRef), transaction.get(actionRef)]);
        const deletionPending = currentCase.exists && (currentCase.data().status === "deleteQueued" || (actionSnapshot.exists && actionSnapshot.data().action === "deleteMaterial" && ["queued", "processing", "failed"].includes(actionSnapshot.data().status)));
        if (currentCase.exists && !deletionPending) transaction.set(currentCase.ref, { status: "expiredEvidence", updatedAt: this.timestamp(this.now()) }, { merge: true });
        transaction.update(intakeRef, { status: "processed", result: "unavailable", processedAt: this.timestamp(this.now()) }); return;
      }
      const source = sourceSnapshot.data();
      if (targetAuthor(intake.targetKind, source) !== intake.reportedUserId) throw coded("invalid-intake");
      const reportRef = caseRef.collection("reports").doc(id);
      const [caseSnapshot, reportSnapshot, actionSnapshot] = await Promise.all([transaction.get(caseRef), transaction.get(reportRef), transaction.get(actionRef)]);
      const evidence = protectedEvidence(snapshotForTarget(intake.targetKind, source));
      const expiredEvidence = intake.targetKind === "roomMessage" && timestampToMillis(source.expiresAt) <= this.now();
      const base = { targetKind: intake.targetKind, targetCollection: intake.targetCollection, targetId: intake.targetId, targetPath: intake.targetPath, reportedUserId: intake.reportedUserId, snapshot: evidence.snapshot, evidenceRetention: retentionBoundary, updatedAt: this.timestamp(this.now()) };
      const deletionPending = caseSnapshot.exists && (caseSnapshot.data().status === "deleteQueued" || (actionSnapshot.exists && actionSnapshot.data().action === "deleteMaterial" && ["queued", "processing", "failed"].includes(actionSnapshot.data().status)));
      if (!caseSnapshot.exists) {
        transaction.set(caseRef, { ...base, status: expiredEvidence ? "expiredEvidence" : "open", reportCount: 0, reasonTotals: {}, createdAt: this.timestamp(this.now()) });
        if (evidence.media.length) transaction.set(caseRef.collection("evidence").doc("media"), { items: evidence.media, createdAt: this.timestamp(this.now()), retention: retentionBoundary });
      }
      else transaction.set(caseRef, { status: deletionPending ? "deleteQueued" : expiredEvidence ? "expiredEvidence" : "open", updatedAt: this.timestamp(this.now()) }, { merge: true });
      if (!reportSnapshot.exists) {
        const totals = caseSnapshot.exists ? (caseSnapshot.data().reasonTotals ?? {}) : {};
        const nextTotals = { ...totals, [intake.reason]: Math.min(PAGE_SIZE, (totals[intake.reason] ?? 0) + 1) };
        transaction.set(reportRef, { reporterUid: intake.reporterUid, reason: intake.reason, createdAt: intake.createdAt });
        transaction.set(caseRef, { reportCount: (caseSnapshot.exists ? caseSnapshot.data().reportCount ?? 0 : 0) + 1, reasonTotals: nextTotals }, { merge: true });
      }
      if (!expiredEvidence && intake.targetKind !== "user") transaction.set(sourceRef, { moderationState: "hidden", moderationUpdatedAt: this.timestamp(this.now()) }, { merge: true });
      transaction.update(intakeRef, { status: "processed", result: expiredEvidence ? "expiredEvidence" : "captured", processedAt: this.timestamp(this.now()) });
    });
  }
  async failIntake(id, token, errorCode) { await this.#fail(this.intakeRef(id), token, errorCode); }
  async failAction(id, token, errorCode) { await this.#fail(this.actionRef(id), token, errorCode); }
  async failLegacyRoom(id, token, errorCode) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.legacyRoomQueueRef(id); const data = await this.#assertLease(transaction, reference, token);
      if ((data.attempts ?? 0) >= MAX_ATTEMPTS) {
        transaction.update(reference, { status: "manualReview", terminalPolicy: "manual-review", errorCode, terminalAt: this.timestamp(this.now()) });
        return true;
      }
      transaction.update(reference, { status: "failed", errorCode, nextAttemptAt: this.timestamp(this.now() + retryDelayMillis(data.attempts ?? 1)) });
      return false;
    });
  }
  async #fail(reference, token, errorCode) { await this.db.runTransaction(async (transaction) => {
    const data = await this.#assertLease(transaction, reference, token); const retryAt = this.now() + retryDelayMillis(data.attempts ?? 1);
    transaction.update(reference, { status: "failed", errorCode, nextAttemptAt: this.timestamp(retryAt) });
  }); }
  async executeClaimedAction(id, token) {
    const action = await this.db.runTransaction(async (transaction) => {
      const data = await this.#assertLease(transaction, this.actionRef(id), token); return { ...data };
    });
    if (action.action === "restore") return this.#restore(id, token);
    if (action.action === "deleteMaterial") return this.#deleteMaterial(id, token);
    throw coded("action-invalid");
  }
  async #restore(id, token) {
    const outcome = await this.db.runTransaction(async (transaction) => {
      const actionRef = this.actionRef(id); await this.#assertLease(transaction, actionRef, token);
      const caseRef = this.caseRef(id); const caseSnapshot = await transaction.get(caseRef);
      if (!caseSnapshot.exists) { transaction.delete(actionRef); return "missing"; }
      const item = caseSnapshot.data(); const sourceRef = this.db.collection(item.targetCollection).doc(item.targetId); const source = await transaction.get(sourceRef);
      const invalidEvidence = restoreOutcome(item, source, this.now()) === "expired";
      if (source.exists && item.targetKind !== "user" && !invalidEvidence) transaction.set(sourceRef, { moderationState: "visible", moderationUpdatedAt: this.timestamp(this.now()) }, { merge: true });
      transaction.set(caseRef, { status: invalidEvidence ? "expiredEvidence" : "restored", updatedAt: this.timestamp(this.now()) }, { merge: true });
      return invalidEvidence ? "expired" : "restored";
    });
    if (outcome === "expired") throw coded("expired-evidence");
    if (outcome === "missing") return;
    await this.#deleteProcessedReceipts(id, token);
    await this.db.runTransaction(async (transaction) => { await this.#assertLease(transaction, this.actionRef(id), token); transaction.delete(this.actionRef(id)); });
  }
  async #deleteProcessedReceipts(caseIdValue, token) {
    const target = await this.caseRef(caseIdValue).get(); if (!target.exists) return;
    const item = target.data(); let deleted = 0;
    while (true) {
      await this.renewAction(caseIdValue, token);
      const page = await this.db.collection("reportIntakes").where("targetPath", "==", item.targetPath).where("status", "==", "processed").limit(PAGE_SIZE).get();
      if (page.empty) break;
      const receiptRefs = page.docs.flatMap((document) => {
        const intake = document.data();
        if (!isValidModerationIntake(document.id, intake)
          || intake.targetKind !== item.targetKind || intake.targetId !== item.targetId) return [];
        return [this.db.collection("reportReceipts").doc(intake.reporterUid).collection(item.targetKind).doc(item.targetId)];
      });
      await this.#deleteLeasedRefs(caseIdValue, token, [...page.docs.map((document) => document.ref), ...receiptRefs]); deleted += page.size;
      if (deleted > PAGE_SIZE * MAX_ATTEMPTS) throw coded("action-limit");
    }
  }
  async #deleteMaterial(id, token) {
    await this.db.runTransaction(async (transaction) => {
      const action = await this.#assertLease(transaction, this.actionRef(id), token);
      const caseRef = this.caseRef(id); const caseSnapshot = await transaction.get(caseRef);
      if (caseSnapshot.exists && caseSnapshot.data().targetKind === "user") throw coded("action-invalid");
      if (caseSnapshot.exists) transaction.set(caseRef, { status: "deleteQueued", updatedAt: this.timestamp(this.now()), actionRequestedAt: action.requestedAt, actionRequestedBy: action.requestedBy }, { merge: true });
    });
    const caseSnapshot = await this.caseRef(id).get();
    if (!caseSnapshot.exists) { await this.db.runTransaction(async (transaction) => { await this.#assertLease(transaction, this.actionRef(id), token); transaction.delete(this.actionRef(id)); }); return; }
    const item = caseSnapshot.data(); await this.renewAction(id, token);
    if (["post", "communityPost"].includes(item.targetKind)) await this.#deletePostCascade(id, token, this.db.collection(item.targetCollection).doc(item.targetId));
    else if (item.targetKind === "roomMessage") await this.#deleteDocumentTree(id, token, this.db.collection("roomMessages").doc(item.targetId));
    await this.#deleteDocumentTree(id, token, this.caseRef(id));
    await this.db.runTransaction(async (transaction) => { await this.#assertLease(transaction, this.actionRef(id), token); transaction.delete(this.actionRef(id)); });
  }
  async #deletePostCascade(id, token, postRef) {
    await this.#deleteChildCollections(id, token, postRef);
    for (const collection of ["communityVotes", "timelineVotes"]) await this.#deleteWhere(id, token, this.db.collection(collection).where("postId", "==", postRef.id));
    await this.renewAction(id, token); const snapshot = await postRef.get(); if (snapshot.exists) await this.#deleteLeasedRef(id, token, postRef);
  }
  async #deleteDocumentTree(id, token, reference) {
    await this.#deleteChildCollections(id, token, reference);
    await this.renewAction(id, token); const snapshot = await reference.get(); if (snapshot.exists) await this.#deleteLeasedRef(id, token, reference);
  }
  async #deleteChildCollections(id, token, reference) {
    const collections = await reference.listCollections();
    for (const collection of collections) await this.#deleteWhere(id, token, collection, async (refs) => { for (const ref of refs) await this.#deleteDocumentTree(id, token, ref); });
  }
  async #deleteWhere(id, token, query, beforeDelete = async () => {}) {
    let passes = 0;
    while (passes++ < MAX_ATTEMPTS) {
      await this.renewAction(id, token); const page = await query.orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE).get();
      if (page.empty) return; const refs = page.docs.map((doc) => doc.ref); await beforeDelete(refs);
      for (let offset = 0; offset < refs.length; offset += 400) { await this.renewAction(id, token); await this.#deleteLeasedRefs(id, token, refs.slice(offset, offset + 400)); }
    }
    throw coded("action-limit");
  }
  async executeClaimedLegacyRoom(id, token, { ownerId, runCutoff }) {
    const queue = await this.db.runTransaction(async (transaction) => ({ ...(await this.#assertLease(transaction, this.legacyRoomQueueRef(id), token)) }));
    const renewQueueLease = () => this.#renew(this.legacyRoomQueueRef(id), token);
    const removed = await this.#cleanupRoom(queue.roomId, {
      ownerId, runCutoff, allowInvalidTimestamp: true, onProgress: renewQueueLease,
      legacyQueue: { reference: this.legacyRoomQueueRef(id), token }
    });
    if (removed === "resolved") return false;
    if (!removed) {
      const room = await this.db.collection("rooms").doc(queue.roomId).get();
      if (room.exists) throw coded("lease-lost");
    }
    await this.db.runTransaction(async (transaction) => {
      const reference = this.legacyRoomQueueRef(id); await this.#assertLease(transaction, reference, token);
      transaction.update(reference, { status: "cleaned", completedAt: this.timestamp(this.now()) });
    });
    return true;
  }
  async cleanupExpiredRoom(id, { ownerId = "room-cleanup", runCutoff = this.now() } = {}) {
    return this.#cleanupRoom(id, { ownerId, runCutoff, allowInvalidTimestamp: false, onProgress: async () => {} });
  }
  async cleanupRoomForTrustedDeletion(id, { ownerId = "trusted-room-deletion", onProgress = async () => {} } = {}) {
    return this.#cleanupRoom(id, { ownerId, runCutoff: this.now(), allowInvalidTimestamp: true, onProgress });
  }
  async cleanupRoomMessageForTrustedDeletion(id, { ownerId = "trusted-message-deletion", onProgress = async () => {} } = {}) {
    const messageRef = this.db.collection("roomMessages").doc(id); const initial = await messageRef.get();
    if (!initial.exists) return false;
    if (!safeRoomId(initial.data().roomId)) {
      await this.#drainUnfencedTargetIntakes(messageRef.path, ownerId, onProgress);
      await this.#deleteDocumentDescendants(messageRef, onProgress);
      await messageRef.delete(); return true;
    }
    const roomRef = this.db.collection("rooms").doc(initial.data().roomId); const leaseToken = this.tokenFactory();
    await this.beforeRoomMessageCleanupClaim?.({ messageId: id, roomId: initial.data().roomId });
    const claimed = await this.db.runTransaction(async (transaction) => {
      const [room, message] = await Promise.all([transaction.get(roomRef), transaction.get(messageRef)]);
      if (!message.exists) return false;
      if (!room.exists) return "orphan";
      if (message.data().roomId !== room.id || timestampToMillis(room.data().cleanupLeaseExpiresAt) > this.now()) return false;
      transaction.set(roomRef, {
        cleanupState: "closing", cleanupLeaseOwner: ownerId, cleanupLeaseToken: leaseToken,
        cleanupLeaseExpiresAt: this.timestamp(this.now() + LEASE_MS)
      }, { merge: true });
      return true;
    });
    if (!claimed) return false;
    if (claimed === "orphan") {
      await this.#drainUnfencedTargetIntakes(messageRef.path, ownerId, onProgress);
      await this.#deleteDocumentDescendants(messageRef, onProgress);
      await messageRef.delete(); return true;
    }
    let completed = false;
    try {
      await onProgress(); await this.#drainTargetIntakes(messageRef.path, ownerId, roomRef, leaseToken); await onProgress();
      await this.#deleteDocumentDescendants(messageRef, async () => {
        await onProgress();
        await this.#renewRoomLease(roomRef, leaseToken);
      });
      await this.db.runTransaction(async (transaction) => {
        const [room, message] = await Promise.all([transaction.get(roomRef), transaction.get(messageRef)]);
        if (!room.exists || room.data().cleanupLeaseToken !== leaseToken || timestampToMillis(room.data().cleanupLeaseExpiresAt) <= this.now()) throw coded("lease-lost");
        if (message.exists) transaction.delete(messageRef);
        transaction.set(roomRef, { cleanupState: "open", cleanupLeaseOwner: "", cleanupLeaseToken: "", cleanupLeaseExpiresAt: this.timestamp(this.now()) }, { merge: true });
      });
      completed = true;
    } finally {
      if (!completed) await this.#releaseRoomLease(roomRef, leaseToken).catch(() => {});
    }
    return true;
  }
  async #drainUnfencedTargetIntakes(targetPath, ownerId, onProgress) {
    let passes = 0;
    while (passes++ < MAX_ATTEMPTS) {
      await onProgress();
      const page = await this.db.collection("reportIntakes").where("targetPath", "==", targetPath)
        .where("status", "in", ["queued", "failed", "processing"]).limit(PAGE_SIZE).get();
      if (page.empty) return;
      for (const intake of page.docs) {
        const claim = await this.claimIntake(intake.id, ownerId);
        if (!claim) {
          if (await this.settleTerminalIntake(intake.id)) continue;
          throw coded("unsettled-intake");
        }
        try { await this.processClaimedIntake(claim.id, claim.token); }
        catch (error) { await this.failIntake(claim.id, claim.token, fixedErrorCode(error)).catch(() => {}); throw error; }
      }
    }
    throw coded("action-limit");
  }
  async #cleanupRoom(id, { ownerId, runCutoff, allowInvalidTimestamp, onProgress, legacyQueue }) {
    const roomRef = this.db.collection("rooms").doc(id);
    const leaseToken = this.tokenFactory();
    await this.beforeRoomCleanupClaim?.({ roomId: id, runCutoff });
    const claimed = await this.db.runTransaction(async (transaction) => {
      if (legacyQueue) await this.#assertLease(transaction, legacyQueue.reference, legacyQueue.token);
      const snapshot = await transaction.get(roomRef); if (!snapshot.exists) return false; const data = snapshot.data();
      const expiry = timestampToMillis(data.expiresAt);
      const createdAt = timestampToMillis(data.createdAt);
      if (legacyQueue && Number.isFinite(createdAt) && Number.isFinite(expiry) && expiry > runCutoff) {
        transaction.update(legacyQueue.reference, {
          status: "resolved", resolution: "room-repaired", resolvedAt: this.timestamp(this.now())
        });
        transaction.set(roomRef, {
          cleanupState: "open", lifecycleMigrationState: "resolved", lifecycleMigrationUpdatedAt: this.timestamp(this.now())
        }, { merge: true });
        return "resolved";
      }
      if ((!allowInvalidTimestamp && (!Number.isFinite(expiry) || expiry > runCutoff)) || timestampToMillis(data.cleanupLeaseExpiresAt) > this.now()) return false;
      transaction.update(roomRef, { cleanupState: "closing", cleanupRunCutoffAt: this.timestamp(runCutoff), cleanupLeaseOwner: ownerId, cleanupLeaseToken: leaseToken, cleanupLeaseExpiresAt: this.timestamp(this.now() + LEASE_MS) }); return true;
    });
    if (!claimed || claimed === "resolved") return claimed;
    for (const collection of ["roomMessages", "roomMembers"]) {
      let passes = 0; while (passes++ < MAX_ATTEMPTS) {
        await onProgress();
        await this.#renewRoomLease(roomRef, leaseToken);
        const page = await this.db.collection(collection).where("roomId", "==", id).orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE).get();
        if (page.empty) break;
        if (collection === "roomMessages") for (const message of page.docs) {
          await this.#drainTargetIntakes(message.ref.path, ownerId, roomRef, leaseToken);
          await this.#deleteDocumentDescendants(message.ref, async () => {
            await onProgress();
            await this.#renewRoomLease(roomRef, leaseToken);
          });
        }
        await this.#renewRoomLease(roomRef, leaseToken); const batch = this.db.batch(); page.docs.forEach((doc) => batch.delete(doc.ref)); await batch.commit();
      }
      if (passes > MAX_ATTEMPTS) throw coded("action-limit");
    }
    await onProgress();
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(roomRef); if (!snapshot.exists || snapshot.data().cleanupLeaseToken !== leaseToken || timestampToMillis(snapshot.data().cleanupLeaseExpiresAt) <= this.now()) throw coded("lease-lost");
      transaction.delete(roomRef);
    }); return true;
  }
  async #drainTargetIntakes(targetPath, ownerId, roomRef, roomLeaseToken) {
    let passes = 0;
    while (passes++ < MAX_ATTEMPTS) {
      await this.#renewRoomLease(roomRef, roomLeaseToken);
      const page = await this.db.collection("reportIntakes").where("targetPath", "==", targetPath)
        .where("status", "in", ["queued", "failed", "processing"]).limit(PAGE_SIZE).get();
      if (page.empty) return;
      for (const intake of page.docs) {
        const claim = await this.claimIntake(intake.id, ownerId);
        if (!claim) {
          if (await this.settleTerminalIntake(intake.id)) continue;
          throw coded("unsettled-intake");
        }
        try { await this.processClaimedIntake(claim.id, claim.token); }
        catch (error) { await this.failIntake(claim.id, claim.token, fixedErrorCode(error)).catch(() => {}); throw error; }
      }
    }
    throw coded("action-limit");
  }
  async #deleteDocumentDescendants(reference, onProgress) {
    await onProgress();
    const collections = await reference.listCollections();
    for (const collection of collections) {
      let passes = 0;
      while (passes++ < MAX_ATTEMPTS) {
        await onProgress();
        const page = await collection.orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE).get();
        if (page.empty) break;
        for (const child of page.docs) await this.#deleteDocumentDescendants(child.ref, onProgress);
        await onProgress();
        const batch = this.db.batch(); page.docs.forEach((child) => batch.delete(child.ref)); await batch.commit();
      }
      if (passes > MAX_ATTEMPTS) throw coded("action-limit");
    }
  }
  async #deleteRef(reference) { const batch = this.db.batch(); batch.delete(reference); await batch.commit(); }
  async #renewRoomLease(reference, token) { await this.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference); if (!snapshot.exists || snapshot.data().cleanupLeaseToken !== token || timestampToMillis(snapshot.data().cleanupLeaseExpiresAt) <= this.now()) throw coded("lease-lost");
    transaction.update(reference, { cleanupLeaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
  }); }
  async #releaseRoomLease(reference, token) { await this.db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data().cleanupLeaseToken !== token) return;
    transaction.set(reference, {
      cleanupState: timestampToMillis(snapshot.data().expiresAt) > this.now() ? "open" : "closing",
      cleanupLeaseOwner: "", cleanupLeaseToken: "", cleanupLeaseExpiresAt: this.timestamp(this.now())
    }, { merge: true });
  }); }
  async #deleteLeasedRef(id, token, reference) { this.beforeLeasedDelete?.([reference]); await this.db.runTransaction(async (transaction) => { await this.#assertLease(transaction, this.actionRef(id), token); transaction.delete(reference); }); }
  async #deleteLeasedRefs(id, token, references) { this.beforeLeasedDelete?.(references); await this.db.runTransaction(async (transaction) => { await this.#assertLease(transaction, this.actionRef(id), token); references.forEach((reference) => transaction.delete(reference)); }); }
}
