export const PAGE_LIMIT = 200;
export const BATCH_LIMIT = 400;
export const LEASE_MS = 5 * 60 * 1000;
export const COMPLETION_RETENTION_MS = 2 * 60 * 60 * 1000;
export const PROTECTED_ADMINISTRATORS = Object.freeze(["i_love_you_h", "cybercapone"]);

const timestampMillis = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return Number.NaN;
};
const hasExactKeys = (value, keys) => value && typeof value === "object"
  && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");

export const normalizeAdministrator = (value) => String(value ?? "").trim().toLowerCase();
export const isProtectedAdministrator = (value) => PROTECTED_ADMINISTRATORS.includes(normalizeAdministrator(value));
export const isTrustedRequester = (uid, profile, reservation) => profile?.uid === uid
  && profile?.banned !== true
  && isProtectedAdministrator(profile?.username)
  && reservation?.uid === uid
  && reservation?.username === profile.username;
export const isExactQueuedJob = (job, targetUid) => hasExactKeys(job, ["targetUid", "requesterUid", "requestedAt", "status"])
  && job.targetUid === targetUid && typeof job.requesterUid === "string" && job.requesterUid.length > 0
  && Number.isFinite(timestampMillis(job.requestedAt)) && job.status === "queued";
export const isExactSelfQueuedJob = (job, targetUid) => hasExactKeys(job, ["targetUid", "requesterUid", "requestedAt", "requestType", "status"])
  && job.targetUid === targetUid && job.requesterUid === targetUid && job.requestType === "self"
  && Number.isFinite(timestampMillis(job.requestedAt)) && job.status === "queued";
export const isClaimableJob = (job, nowMillis) => Boolean(job && (
  job.status === "queued" || job.status === "failed" || (job.status === "processing"
    && Number.isFinite(timestampMillis(job.leaseExpiresAt)) && timestampMillis(job.leaseExpiresAt) <= nowMillis)
));
export const completionMarker = (completedAt, timestampFactory = (value) => value) => ({
  status: "completed", completedAt,
  purgeAfter: timestampFactory(timestampMillis(completedAt) + COMPLETION_RETENTION_MS)
});
export const isExactCompletionMarker = (marker) => hasExactKeys(marker, ["status", "completedAt", "purgeAfter"])
  && marker.status === "completed" && Number.isFinite(timestampMillis(marker.completedAt))
  && timestampMillis(marker.purgeAfter) - timestampMillis(marker.completedAt) === COMPLETION_RETENTION_MS;
export const isValidAccountStats = (stats) => hasExactKeys(stats, ["count", "limit", "updatedAt"])
  && Number.isInteger(stats.count) && stats.count >= 1 && stats.limit === 500
  && Number.isFinite(timestampMillis(stats.updatedAt));

const direct = (name, collection, path, extra = {}) => ({ name, collection, path, limit: PAGE_LIMIT, ...extra });
const field = (name, collection, fieldName, value, extra = {}) => ({
  name, collection, field: fieldName, value, limit: PAGE_LIMIT, ...extra
});
export const cleanupQueries = (targetUid) => Object.freeze([
  field("owned-posts", "posts", "authorId", targetUid, { cascade: "post" }),
  field("reposts-of-target", "posts", "originalAuthorId", targetUid, { cascade: "post" }),
  field("owned-community-posts", "communityPosts", "authorId", targetUid, { cascade: "post" }),
  field("comments-by-target", "comments", "uid", targetUid, { group: true, cascade: "document" }),
  field("replies-by-target", "replies", "uid", targetUid, { group: true, cascade: "document" }),
  field("reactions-by-target", "reactions", "uid", targetUid, { group: true }),
  field("votes-by-target", "communityVotes", "uid", targetUid),
  field("timeline-votes-by-target", "timelineVotes", "uid", targetUid),
  field("follows-from-target", "follows", "followerId", targetUid),
  field("follows-to-target", "follows", "followingId", targetUid),
  field("message-requests-from-target", "messageRequests", "fromId", targetUid),
  field("message-requests-to-target", "messageRequests", "toId", targetUid),
  field("direct-messages", "directMessages", "participants", targetUid, { operator: "array-contains" }),
  field("private-conversations", "privateConversations", "participants", targetUid, { operator: "array-contains" }),
  field("reveals-from-target", "reveals", "fromId", targetUid),
  field("reveals-to-target", "reveals", "toId", targetUid),
  field("owned-rooms", "rooms", "ownerId", targetUid, { cascade: "room" }),
  field("room-memberships", "roomMembers", "uid", targetUid),
  field("room-messages", "roomMessages", "senderId", targetUid, { cascade: "roomMessage" }),
  field("owned-circles", "circles", "ownerId", targetUid, { cascade: "circle" }),
  field("circle-memberships", "circleMembers", "uid", targetUid),
  direct("preferences", "userPreferences", targetUid),
  direct("private-profile", "userPrivate", targetUid),
  field("report-intakes-by-target", "reportIntakes", "reporterUid", targetUid),
  field("report-intakes-about-target", "reportIntakes", "reportedUserId", targetUid),
  field("case-reports-by-target", "reports", "reporterUid", targetUid, { group: true }),
  field("moderation-cases-about-target", "moderationCases", "reportedUserId", targetUid, { cascade: "moderation-case" }),
  direct("report-receipts", "reportReceipts", targetUid, {
    cascade: "document", subcollections: ["post", "communityPost", "roomMessage", "user"]
  }),
  field("blocks-by-target", "blocks", "blockerUid", targetUid),
  field("blocks-of-target", "blocks", "blockedUid", targetUid),
  direct("push-subscription-document", "pushSubscriptions", targetUid),
  field("push-subscriptions", "pushSubscriptions", "uid", targetUid),
  field("notification-events", "notificationEvents", "targetUid", targetUid),
  field("notification-events-for-target", "notificationEvents", "recipientUid", targetUid),
  field("notification-events-by-target", "notificationEvents", "actorUid", targetUid),
  field("notification-deliveries", "notificationDeliveries", "uid", targetUid),
  field("notification-deliveries-for-target", "notificationDeliveries", "recipientUid", targetUid),
  field("notification-reads", "notificationReads", "uid", targetUid)
]);

const ERROR_CODES = new Map([
  ["auth/user-not-found", "AUTH_NOT_FOUND"], ["auth/internal-error", "AUTH_ERROR"],
  ["lease-lost", "LEASE_LOST"], ["untrusted-requester", "UNTRUSTED_REQUESTER"],
  ["invalid-job", "INVALID_JOB"], ["protected-target", "PROTECTED_TARGET"],
  ["profile-recreated", "PROFILE_RECREATED"], ["cleanup-limit", "CLEANUP_LIMIT"],
  ["action-limit", "CLEANUP_LIMIT"], ["unsettled-intake", "UNSETTLED_INTAKE"],
  ["account-stats-invalid", "ACCOUNT_STATS_INVALID"],
  ["heartbeat-failed", "HEARTBEAT_ERROR"], ["malformed-marker", "MALFORMED_MARKER"]
]);
export const fixedErrorCode = (error) => ERROR_CODES.get(error?.code) ?? "PROCESSOR_FAILURE";
export const timestampToMillis = timestampMillis;
