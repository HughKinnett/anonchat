export const PAGE_LIMIT = 200;
export const BATCH_LIMIT = 400;
export const LEASE_MS = 5 * 60 * 1000;
export const COMPLETION_RETENTION_MS = 2 * 60 * 60 * 1000;
export const PROTECTED_ADMINISTRATORS = Object.freeze(["i_love_you_h", "ownercybercapone"]);

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

const direct = (name, collection, path) => ({ name, collection, path, limit: PAGE_LIMIT });
const field = (name, collection, fieldName, value, extra = {}) => ({
  name, collection, field: fieldName, value, limit: PAGE_LIMIT, ...extra
});
export const cleanupQueries = (targetUid, username = "") => Object.freeze([
  field("owned-posts", "posts", "authorId", targetUid, { cascade: "post" }),
  field("reposts-of-target", "posts", "originalAuthorId", targetUid, { cascade: "post" }),
  field("posts-by-username", "posts", "username", username),
  field("original-posts-by-username", "posts", "originalUsername", username),
  field("owned-community-posts", "communityPosts", "authorId", targetUid, { cascade: "post" }),
  field("community-posts-by-username", "communityPosts", "username", username),
  field("comments-by-target", "comments", "uid", targetUid, { group: true }),
  field("comments-by-username", "comments", "username", username, { group: true }),
  field("replies-by-target", "replies", "uid", targetUid, { group: true }),
  field("replies-by-username", "replies", "username", username, { group: true }),
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
  field("room-messages", "roomMessages", "senderId", targetUid),
  field("owned-circles", "circles", "ownerId", targetUid, { cascade: "circle" }),
  field("circle-memberships", "circleMembers", "uid", targetUid),
  direct("preferences", "userPreferences", targetUid),
  direct("private-profile", "userPrivate", targetUid),
  field("reports-by-target", "reports", "reporterId", targetUid),
  field("reports-about-target", "reports", "targetUid", targetUid),
  field("reports-about-user", "reports", "reportedUserId", targetUid),
  field("blocks-by-target", "blocks", "blockerId", targetUid),
  field("blocks-of-target", "blocks", "blockedId", targetUid),
  direct("push-subscription-document", "pushSubscriptions", targetUid),
  field("push-subscriptions", "pushSubscriptions", "uid", targetUid),
  field("notification-events", "notificationEvents", "targetUid", targetUid),
  field("notification-events-for-target", "notificationEvents", "recipientUid", targetUid),
  field("notification-events-by-target", "notificationEvents", "actorUid", targetUid),
  field("notification-deliveries", "notificationDeliveries", "uid", targetUid),
  field("notification-deliveries-for-target", "notificationDeliveries", "recipientUid", targetUid),
  field("notification-reads", "notificationReads", "uid", targetUid),
  direct("self-deletion-request", "accountDeletionRequests", targetUid)
].filter((entry) => entry.value !== ""));

const ERROR_CODES = new Map([
  ["auth/user-not-found", "AUTH_NOT_FOUND"], ["auth/internal-error", "AUTH_ERROR"],
  ["lease-lost", "LEASE_LOST"], ["untrusted-requester", "UNTRUSTED_REQUESTER"],
  ["invalid-job", "INVALID_JOB"], ["protected-target", "PROTECTED_TARGET"],
  ["profile-recreated", "PROFILE_RECREATED"], ["cleanup-limit", "CLEANUP_LIMIT"],
  ["heartbeat-failed", "HEARTBEAT_ERROR"], ["malformed-marker", "MALFORMED_MARKER"]
]);
export const fixedErrorCode = (error) => ERROR_CODES.get(error?.code) ?? "PROCESSOR_FAILURE";
export const timestampToMillis = timestampMillis;
