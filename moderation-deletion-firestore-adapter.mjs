import {
  BATCH_LIMIT,
  LEASE_MS,
  PAGE_LIMIT,
  PROCESSOR_VERSION,
  auditMarker,
  completedJob,
  dependencyNamespaces,
  isClaimableJob,
  isExactCompletedJob,
  isExactQueuedJob,
  isTrustedRequester,
  jobIdForTarget,
  normalizeAdministrator,
  timestampToMillis
} from "./moderation-deletion-policy.mjs";

const PHASES = new Set(["claimed", "reposts-locked", "dependencies-cleaned", "reports-resolved", "reports-removed"]);
const BASE_KEYS = ["targetType", "targetId", "reportId", "requesterUid", "requestedAt"];
const PROCESSING_KEYS = [
  ...BASE_KEYS, "status", "processorVersion", "phase", "attempts", "reportCount",
  "leaseOwner", "leaseToken", "leaseExpiresAt"
];
const FAILED_KEYS = [
  ...BASE_KEYS, "status", "processorVersion", "phase", "attempts", "reportCount", "errorCode"
];
const exactKeys = (value, keys) => value && typeof value === "object"
  && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
const codedError = code => Object.assign(new Error(code), { code });

const isInternalJob = (job, jobId) => {
  const keys = job?.status === "processing" ? PROCESSING_KEYS : FAILED_KEYS;
  return ["processing", "failed"].includes(job?.status)
    && exactKeys(job, keys)
    && jobId === jobIdForTarget(job.targetType, job.targetId)
    && job.processorVersion === PROCESSOR_VERSION
    && PHASES.has(job.phase)
    && Number.isInteger(job.attempts) && job.attempts >= 1
    && Number.isInteger(job.reportCount) && job.reportCount >= 0
    && (job.status !== "processing" || (
      typeof job.leaseOwner === "string" && job.leaseOwner.length > 0
      && typeof job.leaseToken === "string" && job.leaseToken.length > 0
      && Number.isFinite(timestampToMillis(job.leaseExpiresAt))
    ))
    && (job.status !== "failed" || /^[A-Z0-9_]+$/.test(job.errorCode));
};

export const boundedDeleteQuery = async ({
  fetchPage,
  deleteRefs,
  renewLease,
  beforeDelete = async () => {},
  pageLimit = PAGE_LIMIT
}) => {
  const limit = Math.min(PAGE_LIMIT, Math.max(1, pageLimit));
  let deleted = 0;
  while (true) {
    let afterPath;
    let deletedThisPass = 0;
    while (true) {
      await renewLease();
      const documents = await fetchPage({ afterPath, limit });
      if (documents.length === 0) break;
      if (documents.length > limit) throw codedError("cleanup-limit");
      const nextPath = documents.at(-1)?.path;
      if (!nextPath || nextPath === afterPath) throw codedError("cleanup-limit");
      await beforeDelete(documents);
      for (let offset = 0; offset < documents.length; offset += BATCH_LIMIT) {
        const refs = documents.slice(offset, offset + BATCH_LIMIT);
        await renewLease();
        await deleteRefs(refs);
        deleted += refs.length;
        deletedThisPass += refs.length;
      }
      afterPath = nextPath;
    }
    if (deletedThisPass === 0) return deleted;
  }
};

export class FirestoreModerationDeletionAdapter {
  constructor({ db, Timestamp, FieldPath, clock = () => Date.now(), tokenFactory }) {
    this.db = db;
    this.Timestamp = Timestamp;
    this.FieldPath = FieldPath;
    this.clock = clock;
    this.tokenFactory = tokenFactory ?? (() => crypto.randomUUID());
  }
  now() { return this.clock(); }
  timestamp(milliseconds) { return this.Timestamp.fromMillis(milliseconds); }
  jobRef(jobId) { return this.db.collection("moderationDeletionJobs").doc(jobId); }
  async heartbeat(status, errorCode) {
    const data = { status, updatedAt: this.timestamp(this.now()) };
    if (errorCode) data.errorCode = errorCode;
    await this.db.doc("system/moderationDeletionProcessor").set(data);
  }
  async scanJobsPage(cursor) {
    let query = this.db.collection("moderationDeletionJobs")
      .where("status", "in", ["queued", "failed", "processing"])
      .orderBy(this.FieldPath.documentId())
      .limit(PAGE_LIMIT);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    return {
      items: snapshot.docs.map(document => ({ id: document.id, data: document.data() })),
      nextCursor: snapshot.docs.at(-1)?.id
    };
  }
  async validateTrust(jobId, job, transaction) {
    const initial = isExactQueuedJob(job, jobId);
    if (!initial && !isInternalJob(job, jobId)) throw codedError("invalid-job");
    const requesterRef = this.db.collection("users").doc(job.requesterUid);
    const requesterSnapshot = await transaction.get(requesterRef);
    if (!requesterSnapshot.exists) throw codedError("untrusted-requester");
    const requester = requesterSnapshot.data();
    const reservationSnapshot = await transaction.get(
      this.db.collection("usernames").doc(normalizeAdministrator(requester.username))
    );
    if (!reservationSnapshot.exists
      || !isTrustedRequester(job.requesterUid, requester, reservationSnapshot.data())) {
      throw codedError("untrusted-requester");
    }
    const policy = dependencyNamespaces(job.targetType);
    const targetSnapshot = await transaction.get(this.db.collection(policy.targetCollection).doc(job.targetId));
    if (!targetSnapshot.exists) throw codedError("target-unavailable");
    const target = targetSnapshot.data();
    if (target.moderationStatus !== "reported") throw codedError("target-unlocked");
    if (initial) {
      const reportSnapshot = await transaction.get(this.db.collection("reports").doc(job.reportId));
      if (!reportSnapshot.exists) throw codedError("invalid-job");
      const report = reportSnapshot.data();
      const ownerId = job.targetType === "room" ? target.ownerId : target.authorId;
      if (report.status !== "pending" || report.targetType !== job.targetType
        || report.targetId !== job.targetId || report.reportedUserId !== ownerId) {
        throw codedError("invalid-job");
      }
    }
  }
  async preview(job) {
    if (isExactCompletedJob(job.data, job.id)) return false;
    return this.db.runTransaction(async transaction => {
      await this.validateTrust(job.id, job.data, transaction);
      return isClaimableJob(job.data, this.now());
    });
  }
  async claim(jobId, ownerId) {
    return this.db.runTransaction(async transaction => {
      const reference = this.jobRef(jobId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return null;
      const job = snapshot.data();
      if (isExactCompletedJob(job, jobId) || !isClaimableJob(job, this.now())) return null;
      await this.validateTrust(jobId, job, transaction);
      const leaseToken = this.tokenFactory();
      const claimed = {
        targetType: job.targetType,
        targetId: job.targetId,
        reportId: job.reportId,
        requesterUid: job.requesterUid,
        requestedAt: job.requestedAt,
        status: "processing",
        processorVersion: PROCESSOR_VERSION,
        phase: isInternalJob(job, jobId) ? job.phase : "claimed",
        attempts: isInternalJob(job, jobId) ? job.attempts + 1 : 1,
        reportCount: isInternalJob(job, jobId) ? job.reportCount : 0,
        leaseOwner: ownerId,
        leaseToken,
        leaseExpiresAt: this.timestamp(this.now() + LEASE_MS)
      };
      transaction.set(reference, claimed);
      return { id: jobId, token: leaseToken, phase: claimed.phase };
    });
  }
  assertLease(job, jobId, token) {
    if (!isInternalJob(job, jobId) || job.status !== "processing"
      || job.leaseToken !== token || timestampToMillis(job.leaseExpiresAt) <= this.now()) {
      throw codedError("lease-lost");
    }
  }
  async renew(jobId, token) {
    await this.db.runTransaction(async transaction => {
      const reference = this.jobRef(jobId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLease(snapshot.data(), jobId, token);
      transaction.update(reference, { leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  async updatePhase(jobId, token, phase) {
    await this.db.runTransaction(async transaction => {
      const reference = this.jobRef(jobId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLease(snapshot.data(), jobId, token);
      transaction.update(reference, { phase, leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  async deleteRefs(jobId, token, refs) {
    if (refs.length > BATCH_LIMIT) throw codedError("cleanup-limit");
    await this.db.runTransaction(async transaction => {
      const jobSnapshot = await transaction.get(this.jobRef(jobId));
      if (!jobSnapshot.exists) throw codedError("lease-lost");
      this.assertLease(jobSnapshot.data(), jobId, token);
      refs.forEach(reference => transaction.delete(reference));
      transaction.update(this.jobRef(jobId), { leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  async deleteQuery(jobId, token, query, beforeDelete = async () => {}) {
    let cursorSnapshot;
    return boundedDeleteQuery({
      renewLease: () => this.renew(jobId, token),
      fetchPage: async ({ afterPath, limit }) => {
        if (!afterPath) cursorSnapshot = undefined;
        let pageQuery = query.limit(limit);
        if (cursorSnapshot) pageQuery = pageQuery.startAfter(cursorSnapshot);
        const snapshot = await pageQuery.get();
        cursorSnapshot = snapshot.docs.at(-1);
        return snapshot.docs.map(document => document.ref);
      },
      beforeDelete,
      deleteRefs: refs => this.deleteRefs(jobId, token, refs)
    });
  }
  async deleteMatchingQuery(jobId, token, query, predicate) {
    let deleted = 0;
    while (true) {
      let cursorSnapshot;
      let deletedThisPass = 0;
      while (true) {
        await this.renew(jobId, token);
        let pageQuery = query.limit(PAGE_LIMIT);
        if (cursorSnapshot) pageQuery = pageQuery.startAfter(cursorSnapshot);
        const snapshot = await pageQuery.get();
        if (snapshot.empty) break;
        const refs = snapshot.docs.filter(predicate).map(document => document.ref);
        if (refs.length) {
          await this.deleteRefs(jobId, token, refs);
          deleted += refs.length;
          deletedThisPass += refs.length;
        }
        cursorSnapshot = snapshot.docs.at(-1);
      }
      if (deletedThisPass === 0) return deleted;
    }
  }
  async updateRefs(jobId, token, refs, patch) {
    if (refs.length > BATCH_LIMIT) throw codedError("cleanup-limit");
    await this.db.runTransaction(async transaction => {
      const jobSnapshot = await transaction.get(this.jobRef(jobId));
      if (!jobSnapshot.exists) throw codedError("lease-lost");
      this.assertLease(jobSnapshot.data(), jobId, token);
      refs.forEach(reference => transaction.update(reference, patch));
      transaction.update(this.jobRef(jobId), { leaseExpiresAt: this.timestamp(this.now() + LEASE_MS) });
    });
  }
  async lockReposts(jobId, token) {
    const snapshot = await this.jobRef(jobId).get();
    if (!snapshot.exists) throw codedError("lease-lost");
    const job = snapshot.data();
    this.assertLease(job, jobId, token);
    const policy = dependencyNamespaces(job.targetType);
    if (policy.deleteReposts) {
      let cursorSnapshot;
      while (true) {
        await this.renew(jobId, token);
        let pageQuery = this.db.collection("posts")
          .where("originalPostId", "==", job.targetId)
          .orderBy(this.FieldPath.documentId())
          .limit(PAGE_LIMIT);
        if (cursorSnapshot) pageQuery = pageQuery.startAfter(cursorSnapshot);
        const page = await pageQuery.get();
        if (page.empty) break;
        const unlocked = page.docs
          .filter(document => document.data().moderationStatus !== "reported")
          .map(document => document.ref);
        if (unlocked.length) await this.updateRefs(jobId, token, unlocked, {
          moderationStatus: "reported",
          reportedAt: this.timestamp(this.now())
        });
        cursorSnapshot = page.docs.at(-1);
      }
    }
    await this.updatePhase(jobId, token, "reposts-locked");
  }
  async deleteVotes(jobId, token, postId, postCollection) {
    await this.deleteQuery(
      jobId,
      token,
      this.db.collection("communityVotes")
        .where("postId", "==", postId)
        .where("postCollection", "==", postCollection)
        .orderBy(this.FieldPath.documentId())
    );
    const oppositeCollection = postCollection === "posts" ? "communityPosts" : "posts";
    const opposite = await this.db.collection(oppositeCollection).doc(postId).get();
    if (!opposite.exists) {
      await this.deleteMatchingQuery(
        jobId,
        token,
        this.db.collection("communityVotes")
          .where("postId", "==", postId)
          .orderBy(this.FieldPath.documentId()),
        document => document.data().postCollection === undefined
      );
    }
  }
  async deleteSubtree(jobId, token, parentRef) {
    const collections = await parentRef.listCollections();
    for (const childCollection of collections) {
      await this.deleteQuery(
        jobId,
        token,
        childCollection.orderBy(this.FieldPath.documentId()),
        async refs => {
          for (const ref of refs) await this.deleteSubtree(jobId, token, ref);
        }
      );
    }
  }
  async cleanDependencies(jobId, token) {
    const snapshot = await this.jobRef(jobId).get();
    if (!snapshot.exists) throw codedError("lease-lost");
    const job = snapshot.data();
    this.assertLease(job, jobId, token);
    const policy = dependencyNamespaces(job.targetType);
    const targetRef = this.db.collection(policy.targetCollection).doc(job.targetId);
    const targetSnapshot = await targetRef.get();
    if (!targetSnapshot.exists || targetSnapshot.data().moderationStatus !== "reported") throw codedError("target-unlocked");
    await this.deleteSubtree(jobId, token, targetRef);
    if (policy.voteCollection) await this.deleteVotes(
      jobId, token, job.targetId, policy.votePostCollection
    );
    if (policy.deleteReposts) {
      await this.deleteQuery(
        jobId,
        token,
        this.db.collection("posts").where("originalPostId", "==", job.targetId).orderBy(this.FieldPath.documentId()),
        async refs => {
          for (const ref of refs) {
            await this.deleteSubtree(jobId, token, ref);
            await this.deleteVotes(jobId, token, ref.id, "posts");
          }
        }
      );
    }
    for (const collectionName of policy.roomCollections) {
      await this.deleteQuery(
        jobId,
        token,
        this.db.collection(collectionName).where("roomId", "==", job.targetId).orderBy(this.FieldPath.documentId()),
        async refs => {
          for (const ref of refs) await this.deleteSubtree(jobId, token, ref);
        }
      );
    }
    await this.updatePhase(jobId, token, "dependencies-cleaned");
  }
  reportQuery(job) {
    return this.db.collection("reports")
      .where("targetType", "==", job.targetType)
      .where("targetId", "==", job.targetId)
      .orderBy(this.FieldPath.documentId());
  }
  async resolveReports(jobId, token) {
    let cursorSnapshot;
    while (true) {
      const jobSnapshot = await this.jobRef(jobId).get();
      if (!jobSnapshot.exists) throw codedError("lease-lost");
      const job = jobSnapshot.data();
      this.assertLease(job, jobId, token);
      let query = this.reportQuery(job).limit(PAGE_LIMIT);
      if (cursorSnapshot) query = query.startAfter(cursorSnapshot);
      const reports = await query.get();
      if (reports.empty) break;
      await this.db.runTransaction(async transaction => {
        const currentJobSnapshot = await transaction.get(this.jobRef(jobId));
        if (!currentJobSnapshot.exists) throw codedError("lease-lost");
        const currentJob = currentJobSnapshot.data();
        this.assertLease(currentJob, jobId, token);
        let added = 0;
        for (const report of reports.docs) {
          const data = report.data();
          if (data.moderationDeletionJobId !== jobId) added += 1;
          transaction.set(report.ref, {
            status: "resolved",
            resolvedBy: currentJob.requesterUid,
            resolutionAction: dependencyNamespaces(currentJob.targetType).action,
            resolvedAt: this.timestamp(this.now()),
            moderationDeletionJobId: jobId
          }, { merge: true });
        }
        transaction.update(this.jobRef(jobId), {
          reportCount: currentJob.reportCount + added,
          leaseExpiresAt: this.timestamp(this.now() + LEASE_MS)
        });
      });
      cursorSnapshot = reports.docs.at(-1);
    }
    await this.updatePhase(jobId, token, "reports-resolved");
  }
  async removeReports(jobId, token) {
    const snapshot = await this.jobRef(jobId).get();
    if (!snapshot.exists) throw codedError("lease-lost");
    this.assertLease(snapshot.data(), jobId, token);
    await this.deleteQuery(jobId, token, this.reportQuery(snapshot.data()));
    await this.updatePhase(jobId, token, "reports-removed");
  }
  async finalize(jobId, token, completedAt) {
    await this.db.runTransaction(async transaction => {
      const jobRef = this.jobRef(jobId);
      const jobSnapshot = await transaction.get(jobRef);
      if (!jobSnapshot.exists) throw codedError("lease-lost");
      const job = jobSnapshot.data();
      this.assertLease(job, jobId, token);
      if (job.phase !== "reports-removed" || job.reportCount < 1) throw codedError("invalid-job");
      const policy = dependencyNamespaces(job.targetType);
      const targetRef = this.db.collection(policy.targetCollection).doc(job.targetId);
      const targetSnapshot = await transaction.get(targetRef);
      if (!targetSnapshot.exists || targetSnapshot.data().moderationStatus !== "reported") throw codedError("target-unlocked");
      const remainingReports = await transaction.get(this.reportQuery(job).limit(1));
      if (!remainingReports.empty) throw codedError("reports-remain");
      transaction.delete(targetRef);
      transaction.set(this.db.collection("moderationActions").doc(jobId), auditMarker(job, completedAt, job.reportCount));
      transaction.set(jobRef, completedJob(job, completedAt, job.reportCount));
    });
  }
  async fail(jobId, token, errorCode) {
    await this.db.runTransaction(async transaction => {
      const reference = this.jobRef(jobId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      const job = snapshot.data();
      this.assertLease(job, jobId, token);
      const retryPhase = errorCode === "REPORTS_REMAIN" ? "dependencies-cleaned" : job.phase;
      transaction.set(reference, {
        targetType: job.targetType,
        targetId: job.targetId,
        reportId: job.reportId,
        requesterUid: job.requesterUid,
        requestedAt: job.requestedAt,
        status: "failed",
        processorVersion: PROCESSOR_VERSION,
        phase: retryPhase,
        attempts: job.attempts,
        reportCount: job.reportCount,
        errorCode
      });
    });
  }
  async cleanupResolvedReports() {
    let cleaned = 0;
    while (true) {
      let cursorSnapshot;
      let cleanedThisPass = 0;
      while (true) {
        let query = this.db.collection("reports")
          .where("status", "==", "resolved")
          .orderBy(this.FieldPath.documentId())
          .limit(PAGE_LIMIT);
        if (cursorSnapshot) query = query.startAfter(cursorSnapshot);
        const reports = await query.get();
        if (reports.empty) break;
        const deletable = [];
        for (const report of reports.docs) {
          const data = report.data();
          const action = await this.db.collection("moderationActions").doc(jobIdForTarget(data.targetType, data.targetId)).get();
          const marker = action.data();
          if (action.exists && Array.isArray(marker?.reportIds) && marker.reportIds.includes(report.id)
            && marker.reportCount === marker.reportIds.length
            && marker.targetType === data.targetType && marker.targetId === data.targetId
            && marker.action === data.resolutionAction && marker.adminId === data.resolvedBy) {
            deletable.push(report.ref);
          }
        }
        if (deletable.length) {
          const batch = this.db.batch();
          deletable.forEach(reference => batch.delete(reference));
          await batch.commit();
          cleaned += deletable.length;
          cleanedThisPass += deletable.length;
        }
        cursorSnapshot = reports.docs.at(-1);
      }
      if (!cleanedThisPass) return cleaned;
    }
  }
}
