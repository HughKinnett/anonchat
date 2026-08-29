import {
  isTrustedRequester,
  normalizeAdministrator,
  timestampToMillis
} from "./admin-deletion-processor-policy.mjs";

export const PAGE_LIMIT = 200;
export const BATCH_LIMIT = 400;
export const LEASE_MS = 5 * 60 * 1000;
export const PROCESSOR_VERSION = 1;

export { isTrustedRequester, normalizeAdministrator, timestampToMillis };

const TARGETS = Object.freeze({
  post: Object.freeze({
    targetCollection: "posts",
    action: "delete-post",
    voteCollection: "communityVotes",
    votePostCollection: "posts",
    deleteReposts: true,
    roomCollections: Object.freeze([])
  }),
  communityPost: Object.freeze({
    targetCollection: "communityPosts",
    action: "delete-post",
    voteCollection: "communityVotes",
    votePostCollection: "communityPosts",
    deleteReposts: false,
    roomCollections: Object.freeze([])
  }),
  room: Object.freeze({
    targetCollection: "rooms",
    action: "delete-room",
    voteCollection: null,
    votePostCollection: null,
    deleteReposts: false,
    roomCollections: Object.freeze(["roomMessages", "roomMembers"])
  })
});

const exactKeys = (value, keys) => value && typeof value === "object"
  && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");

export const jobIdForTarget = (targetType, targetId) => `${targetType}_${targetId}`;

export const dependencyNamespaces = targetType => {
  const policy = TARGETS[targetType];
  if (!policy) throw new TypeError("Unsupported moderation deletion target");
  return {
    targetCollection: policy.targetCollection,
    action: policy.action,
    voteCollection: policy.voteCollection,
    votePostCollection: policy.votePostCollection,
    deleteReposts: policy.deleteReposts,
    roomCollections: [...policy.roomCollections]
  };
};

const BASE_KEYS = ["targetType", "targetId", "reportId", "requesterUid", "requestedAt"];

export const isExactQueuedJob = (job, jobId) => exactKeys(job, [...BASE_KEYS, "status"])
  && Object.hasOwn(TARGETS, job.targetType)
  && typeof job.targetId === "string" && job.targetId.length > 0
  && typeof job.reportId === "string" && job.reportId.length > 0
  && typeof job.requesterUid === "string" && job.requesterUid.length > 0
  && Number.isFinite(timestampToMillis(job.requestedAt))
  && job.status === "queued"
  && jobId === jobIdForTarget(job.targetType, job.targetId);

export const isClaimableJob = (job, nowMillis) => Boolean(job && (
  job.status === "queued"
  || job.status === "failed"
  || (job.status === "processing"
    && Number.isFinite(timestampToMillis(job.leaseExpiresAt))
    && timestampToMillis(job.leaseExpiresAt) <= nowMillis)
));

export const auditMarker = (job, actedAt, reportCount) => ({
  targetType: job.targetType,
  targetId: job.targetId,
  action: dependencyNamespaces(job.targetType).action,
  adminId: job.requesterUid,
  actedAt,
  jobId: jobIdForTarget(job.targetType, job.targetId),
  reportCount
});

export const completedJob = (job, completedAt, reportCount) => ({
  targetType: job.targetType,
  targetId: job.targetId,
  requesterUid: job.requesterUid,
  requestedAt: job.requestedAt,
  status: "completed",
  completedAt,
  actionId: jobIdForTarget(job.targetType, job.targetId),
  reportCount
});

export const isExactCompletedJob = (job, jobId) => exactKeys(job, [
  "targetType", "targetId", "requesterUid", "requestedAt",
  "status", "completedAt", "actionId", "reportCount"
])
  && Object.hasOwn(TARGETS, job.targetType)
  && typeof job.targetId === "string" && job.targetId.length > 0
  && typeof job.requesterUid === "string" && job.requesterUid.length > 0
  && jobId === jobIdForTarget(job.targetType, job.targetId)
  && job.status === "completed"
  && job.actionId === jobId
  && Number.isFinite(timestampToMillis(job.requestedAt))
  && Number.isFinite(timestampToMillis(job.completedAt))
  && Number.isInteger(job.reportCount) && job.reportCount >= 1;

const ERROR_CODES = new Map([
  ["lease-lost", "LEASE_LOST"],
  ["untrusted-requester", "UNTRUSTED_REQUESTER"],
  ["invalid-job", "INVALID_JOB"],
  ["target-unavailable", "TARGET_UNAVAILABLE"],
  ["cleanup-limit", "CLEANUP_LIMIT"],
  ["reports-remain", "REPORTS_REMAIN"],
  ["target-unlocked", "TARGET_UNLOCKED"],
  ["unavailable", "UNAVAILABLE"]
]);

export const fixedErrorCode = error => ERROR_CODES.get(error?.code) ?? "PROCESSOR_FAILURE";
