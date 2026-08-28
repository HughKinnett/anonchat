import {
  BATCH_LIMIT, LEASE_MS, PAGE_LIMIT, cleanupQueries, isClaimableJob, isExactCompletionMarker,
  isExactQueuedJob, isProtectedAdministrator, isTrustedRequester, isValidAccountStats,
  normalizeAdministrator, timestampToMillis
} from "./admin-deletion-processor-policy.mjs";

const PROCESSOR_VERSION = 1;
const PHASES = new Set(["claimed", "first-sweep", "profile-barrier", "second-sweep", "auth-deleting", "auth-deleted"]);
const RETRY_KEYS = ["attempts", "errorCode", "phase", "processorVersion", "requestedAt", "requesterUid", "status", "targetUid", "targetUsername"];
const PROCESSING_KEYS = ["attempts", "phase", "processorVersion", "requestedAt", "requesterUid", "status", "targetUid", "targetUsername", "leaseOwner", "leaseToken", "leaseExpiresAt"];
const exactKeys = (value, keys) => value && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
const codedError = (code) => Object.assign(new Error(code), { code });
const sameTimestamp = (left, right) => timestampToMillis(left) === timestampToMillis(right);
const validInternalJob = (job, targetUid) => {
  const keys = job?.status === "processing" ? PROCESSING_KEYS : RETRY_KEYS;
  return ["processing", "failed"].includes(job?.status) && exactKeys(job, keys)
    && job.processorVersion === PROCESSOR_VERSION && job.targetUid === targetUid
    && typeof job.requesterUid === "string" && typeof job.targetUsername === "string"
    && Number.isInteger(job.attempts) && job.attempts >= 1 && PHASES.has(job.phase)
    && (job.status !== "processing" || (typeof job.leaseOwner === "string" && typeof job.leaseToken === "string"
      && Number.isFinite(timestampToMillis(job.leaseExpiresAt))))
    && (job.status !== "failed" || /^[A-Z0-9_]+$/.test(job.errorCode));
};

export const boundedDeleteQuery = async ({ fetchPage, deleteRefs, renewLease, beforeDelete = async () => {}, pageLimit = PAGE_LIMIT, maxPasses = 4, maxPages = 500 }) => {
  const limit = Math.min(PAGE_LIMIT, Math.max(1, pageLimit)); let deleted = 0;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let afterPath; let sawDocuments = false; let reachedEnd = false;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
      await renewLease(); const documents = await fetchPage({ afterPath, limit });
      if (documents.length === 0) { reachedEnd = true; break; }
      if (documents.length > limit) throw codedError("cleanup-limit");
      sawDocuments = true; await beforeDelete(documents);
      for (let start = 0; start < documents.length; start += BATCH_LIMIT) {
        const refs = documents.slice(start, start + BATCH_LIMIT); await renewLease(); await deleteRefs(refs); deleted += refs.length;
      }
      const nextPath = documents.at(-1)?.path;
      if (!nextPath || nextPath === afterPath) throw codedError("cleanup-limit");
      afterPath = nextPath;
    }
    if (!reachedEnd) throw codedError("cleanup-limit");
    if (!sawDocuments) return deleted;
  }
  throw codedError("cleanup-limit");
};

export class FirestoreDeletionAdapter {
  constructor({ db, auth, Timestamp, FieldPath, clock = () => Date.now(), tokenFactory, authRenewIntervalMs }) {
    this.db = db; this.auth = auth; this.Timestamp = Timestamp; this.FieldPath = FieldPath;
    this.clock = clock; this.tokenFactory = tokenFactory ?? (() => crypto.randomUUID());
    this.authRenewIntervalMs = authRenewIntervalMs ?? Math.floor(LEASE_MS / 3);
  }
  now() { return this.clock(); }
  timestamp(milliseconds) { return this.Timestamp.fromMillis(milliseconds); }
  jobRef(targetUid) { return this.db.collection("adminDeletionJobs").doc(targetUid); }
  async scanJobsPage(cursor) {
    let query = this.db.collection("adminDeletionJobs")
      .where("status", "in", ["queued", "failed", "processing"])
      .orderBy(this.FieldPath.documentId())
      .limit(PAGE_LIMIT);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    return {
      items: snapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
      nextCursor: snapshot.docs.at(-1)?.id
    };
  }
  async scanMarkersPage(cursor) {
    let query = this.db.collection("adminDeletionJobs")
      .where("status", "==", "completed")
      .orderBy(this.FieldPath.documentId())
      .limit(PAGE_LIMIT);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    return {
      items: snapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
      nextCursor: snapshot.docs.at(-1)?.id
    };
  }
  async heartbeat(status, errorCode) {
    const heartbeat = { status, updatedAt: this.timestamp(this.now()) }; if (errorCode) heartbeat.errorCode = errorCode;
    await this.db.doc("system/deletionProcessor").set(heartbeat);
  }
  async preview(job) {
    if (isExactCompletionMarker(job.data)) return false;
    await this.validateTrust(job.id, job.data, { allowBarrier: true }); return isClaimableJob(job.data, this.now());
  }
  async validateTrust(targetUid, job, { transaction, allowBarrier = false } = {}) {
    const read = (reference) => transaction ? transaction.get(reference) : reference.get();
    const initial = isExactQueuedJob(job, targetUid);
    if (!initial && !validInternalJob(job, targetUid)) throw codedError("invalid-job");
    const requesterSnapshot = await read(this.db.collection("users").doc(job.requesterUid));
    if (!requesterSnapshot.exists) throw codedError("untrusted-requester");
    const requester = requesterSnapshot.data();
    const reservationSnapshot = await read(this.db.collection("usernames").doc(normalizeAdministrator(requester.username)));
    if (!reservationSnapshot.exists || !isTrustedRequester(job.requesterUid, requester, reservationSnapshot.data())) throw codedError("untrusted-requester");
    const targetSnapshot = await read(this.db.collection("users").doc(targetUid));
    if (!targetSnapshot.exists) {
      if (initial || (!allowBarrier && !["profile-barrier", "second-sweep", "auth-deleting", "auth-deleted"].includes(job.phase))) throw codedError("invalid-job");
      return { username: job.targetUsername, profileExists: false };
    }
    const target = targetSnapshot.data();
    if (isProtectedAdministrator(target.username)) throw codedError("protected-target");
    if (!initial && ["profile-barrier", "second-sweep", "auth-deleting", "auth-deleted"].includes(job.phase)) throw codedError("profile-recreated");
    if (target.banned !== true || target.adminDeletionStatus !== "queued" || target.adminDeletionRequestedBy !== job.requesterUid
      || !sameTimestamp(target.adminDeletionRequestedAt, job.requestedAt)) throw codedError("invalid-job");
    return { username: target.username, profileExists: true };
  }
  async claim(targetUid, ownerId) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.jobRef(targetUid); const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return null; const job = snapshot.data();
      if (isExactCompletionMarker(job) || !isClaimableJob(job, this.now())) return null;
      const trust = await this.validateTrust(targetUid, job, { transaction });
      const leaseToken = this.tokenFactory();
      const claimed = {
        targetUid, requesterUid: job.requesterUid, requestedAt: job.requestedAt, status: "processing",
        processorVersion: PROCESSOR_VERSION, targetUsername: trust.username, phase: job.phase ?? "claimed",
        attempts: (validInternalJob(job, targetUid) ? job.attempts : 0) + 1, leaseOwner: ownerId,
        leaseToken, leaseExpiresAt: this.timestamp(this.now() + LEASE_MS)
      };
      transaction.set(reference, claimed); return { targetUid, token: leaseToken, phase: claimed.phase };
    });
  }
  assertLeaseData(job, token) {
    if (!validInternalJob(job, job?.targetUid) || job.status !== "processing" || job.leaseToken !== token
      || timestampToMillis(job.leaseExpiresAt) <= this.now()) throw codedError("lease-lost");
  }
  async renew(targetUid, token) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.jobRef(targetUid); const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost"); this.assertLeaseData(snapshot.data(), token);
      transaction.update(reference, { leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  async updatePhase(targetUid, token, phase) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.jobRef(targetUid); const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost"); this.assertLeaseData(snapshot.data(), token);
      transaction.update(reference, { phase, leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  queryFor(entry) {
    const base = entry.group ? this.db.collectionGroup(entry.collection) : this.db.collection(entry.collection);
    return base.where(entry.field, entry.operator ?? "==", entry.value).orderBy(this.FieldPath.documentId());
  }
  async deleteRefs(targetUid, token, refs) {
    if (refs.length > BATCH_LIMIT) throw codedError("cleanup-limit");
    await this.db.runTransaction(async (transaction) => {
      const jobSnapshot = await transaction.get(this.jobRef(targetUid));
      if (!jobSnapshot.exists) throw codedError("lease-lost"); this.assertLeaseData(jobSnapshot.data(), token);
      refs.forEach((reference) => transaction.delete(reference));
    });
  }
  async deleteQuery(targetUid, token, query, beforeDelete = async () => {}) {
    let cursorSnapshot;
    await boundedDeleteQuery({
      renewLease: () => this.renew(targetUid, token),
      fetchPage: async ({ afterPath, limit }) => {
        if (!afterPath) cursorSnapshot = undefined; let pageQuery = query.limit(limit);
        if (cursorSnapshot) pageQuery = pageQuery.startAfter(cursorSnapshot);
        const snapshot = await pageQuery.get(); cursorSnapshot = snapshot.docs.at(-1);
        return snapshot.docs.map((document) => document.ref);
      }, beforeDelete, deleteRefs: (refs) => this.deleteRefs(targetUid, token, refs)
    });
  }
  async deleteDirect(targetUid, token, entry) {
    const reference = this.db.collection(entry.collection).doc(entry.path); const snapshot = await reference.get();
    if (snapshot.exists) await this.deleteRefs(targetUid, token, [reference]);
  }
  async deleteSubtree(targetUid, token, parentRef) {
    const collections = await parentRef.listCollections();
    for (const childCollection of collections) {
      await this.deleteQuery(targetUid, token, childCollection.orderBy(this.FieldPath.documentId()), async (refs) => {
        for (const ref of refs) await this.deleteSubtree(targetUid, token, ref);
      });
    }
  }
  async deletePostCascade(targetUid, token, postRef) {
    await this.deleteSubtree(targetUid, token, postRef);
    for (const collectionName of ["communityVotes", "timelineVotes"]) {
      await this.deleteQuery(targetUid, token, this.db.collection(collectionName).where("postId", "==", postRef.id).orderBy(this.FieldPath.documentId()));
    }
  }
  async deleteCircleCascade(targetUid, token, circleRef) {
    await this.deleteQuery(targetUid, token, this.db.collection("communityPosts").where("circleId", "==", circleRef.id).orderBy(this.FieldPath.documentId()), async (refs) => {
      for (const ref of refs) await this.deletePostCascade(targetUid, token, ref);
    });
    await this.deleteQuery(targetUid, token, this.db.collection("circleMembers").where("circleId", "==", circleRef.id).orderBy(this.FieldPath.documentId()));
    await this.deleteSubtree(targetUid, token, circleRef);
  }
  async deleteRoomCascade(targetUid, token, roomRef) {
    for (const collectionName of ["roomMessages", "roomMembers"]) {
      await this.deleteQuery(targetUid, token, this.db.collection(collectionName).where("roomId", "==", roomRef.id).orderBy(this.FieldPath.documentId()));
    }
    await this.deleteSubtree(targetUid, token, roomRef);
  }
  async sweep(targetUid, token) {
    const jobSnapshot = await this.jobRef(targetUid).get();
    if (!jobSnapshot.exists) throw codedError("lease-lost"); this.assertLeaseData(jobSnapshot.data(), token);
    for (const entry of cleanupQueries(targetUid, jobSnapshot.data().targetUsername)) {
      if (entry.path) { await this.deleteDirect(targetUid, token, entry); continue; }
      const cascade = async (refs) => {
        for (const ref of refs) {
          if (entry.cascade === "post") await this.deletePostCascade(targetUid, token, ref);
          if (entry.cascade === "circle") await this.deleteCircleCascade(targetUid, token, ref);
          if (entry.cascade === "room") await this.deleteRoomCascade(targetUid, token, ref);
        }
      };
      await this.deleteQuery(targetUid, token, this.queryFor(entry), cascade);
    }
  }
  async firstSweep(targetUid, token) { await this.sweep(targetUid, token); await this.updatePhase(targetUid, token, "first-sweep"); }
  async removeProfileBarrier(targetUid, token) {
    await this.db.runTransaction(async (transaction) => {
      const jobRef = this.jobRef(targetUid); const profileRef = this.db.collection("users").doc(targetUid); const statsRef = this.db.doc("system/accountStats");
      const jobSnapshot = await transaction.get(jobRef); if (!jobSnapshot.exists) throw codedError("lease-lost");
      const job = jobSnapshot.data(); this.assertLeaseData(job, token);
      if (job.phase !== "first-sweep") throw codedError("invalid-job");
      const profileSnapshot = await transaction.get(profileRef); const statsSnapshot = await transaction.get(statsRef);
      const usernameRef = this.db.collection("usernames").doc(normalizeAdministrator(job.targetUsername));
      const usernameSnapshot = await transaction.get(usernameRef);
      if (!profileSnapshot.exists) throw codedError("invalid-job");
      if (isProtectedAdministrator(profileSnapshot.data().username)) throw codedError("protected-target");
      if (!statsSnapshot.exists || !isValidAccountStats(statsSnapshot.data())) throw codedError("account-stats-invalid");
      transaction.delete(profileRef); if (usernameSnapshot.exists && usernameSnapshot.data().uid === targetUid) transaction.delete(usernameRef);
      transaction.update(statsRef, {
        count: statsSnapshot.data().count - 1,
        limit: 500, updatedAt: this.timestamp(this.now())
      });
      transaction.update(jobRef, { phase: "profile-barrier", leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  async secondSweep(targetUid, token) { await this.sweep(targetUid, token); await this.updatePhase(targetUid, token, "second-sweep"); }
  async beginAuthDeletion(targetUid, token) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.jobRef(targetUid); const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLeaseData(snapshot.data(), token);
      if (!["second-sweep", "auth-deleting"].includes(snapshot.data().phase)) throw codedError("invalid-job");
      transaction.update(reference, { phase: "auth-deleting", leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  async deleteAuth(targetUid, token) {
    await this.renew(targetUid, token);
    let renewal = Promise.resolve(); let renewalError;
    const renewWhilePending = () => {
      renewal = renewal.then(() => this.renew(targetUid, token)).catch((error) => { renewalError = error; });
    };
    const timer = setInterval(renewWhilePending, this.authRenewIntervalMs); timer.unref?.();
    let authError;
    try {
      await this.auth.deleteUser(targetUid);
    } catch (error) {
      if (error?.code !== "auth/user-not-found") authError = error;
    } finally {
      clearInterval(timer);
      await renewal;
    }
    if (renewalError) throw renewalError;
    if (authError) throw authError;
    await this.renew(targetUid, token);
  }
  async finishAuthDeletion(targetUid, token) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.jobRef(targetUid); const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLeaseData(snapshot.data(), token);
      if (snapshot.data().phase !== "auth-deleting") throw codedError("invalid-job");
      transaction.update(reference, { phase: "auth-deleted", leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  async finalize(targetUid, token, completedAt, purgeAfter) {
    await this.db.runTransaction(async (transaction) => {
      const jobRef = this.jobRef(targetUid); const profileRef = this.db.collection("users").doc(targetUid);
      const jobSnapshot = await transaction.get(jobRef); if (!jobSnapshot.exists) throw codedError("lease-lost");
      this.assertLeaseData(jobSnapshot.data(), token); if (jobSnapshot.data().phase !== "auth-deleted") throw codedError("invalid-job");
      const profileSnapshot = await transaction.get(profileRef); if (profileSnapshot.exists) throw codedError("profile-recreated");
      const reservations = await transaction.get(this.db.collection("usernames").where("uid", "==", targetUid).limit(1));
      if (!reservations.empty) throw codedError("profile-recreated");
      transaction.set(jobRef, { status: "completed", completedAt, purgeAfter });
    });
  }
  async fail(targetUid, token, errorCode) {
    await this.db.runTransaction(async (transaction) => {
      const jobRef = this.jobRef(targetUid); const profileRef = this.db.collection("users").doc(targetUid);
      const jobSnapshot = await transaction.get(jobRef); if (!jobSnapshot.exists) throw codedError("lease-lost");
      const job = jobSnapshot.data(); this.assertLeaseData(job, token); const profileSnapshot = await transaction.get(profileRef);
      if (profileSnapshot.exists) transaction.update(profileRef, {
        banned: true, adminDeletionRequestedAt: job.requestedAt, adminDeletionRequestedBy: job.requesterUid, adminDeletionStatus: "queued"
      });
      transaction.set(jobRef, {
        targetUid, requesterUid: job.requesterUid, requestedAt: job.requestedAt, status: "failed",
        processorVersion: PROCESSOR_VERSION, targetUsername: job.targetUsername, phase: job.phase,
        attempts: job.attempts, errorCode
      });
    });
  }
  async purgeMarker(targetUid) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.jobRef(targetUid); const snapshot = await transaction.get(reference); if (!snapshot.exists) return;
      const marker = snapshot.data();
      if (!isExactCompletionMarker(marker) || timestampToMillis(marker.purgeAfter) > this.now()) throw codedError("malformed-marker");
      transaction.delete(reference);
    });
  }
}
