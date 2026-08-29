import { restorePostPayload, restoreRoomPayload } from "./moderation-policy.mjs";
import { postImagePresentation } from "./post-report-ui-policy.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROCESSOR_WORKING_MS = 10 * 60 * 1000;
const PROCESSOR_DELAYED_MS = 20 * 60 * 1000;

export const MAX_MODERATION_BATCH_WRITES = 400;
const TARGET_COLLECTIONS = {
  post: "posts",
  communityPost: "communityPosts",
  room: "rooms"
};
const ACTIONS_BY_TARGET = {
  post: new Set(["restore-post", "delete-post"]),
  communityPost: new Set(["restore-post", "delete-post"]),
  room: new Set(["restore-room", "delete-room"])
};

export const timestampMillis = value => {
  const millis = value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value);
  return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
};

export const moderationTargetCollection = targetType => TARGET_COLLECTIONS[targetType] ?? null;

export const filterPendingReports = reports => [...reports]
  .filter(report => report?.status === "pending" && moderationTargetCollection(report.targetType))
  .sort((left, right) => {
    const timeDifference = (timestampMillis(right.createdAt) ?? -Infinity) - (timestampMillis(left.createdAt) ?? -Infinity);
    return timeDifference || String(left.id || "").localeCompare(String(right.id || ""));
  });

export const pendingReports = filterPendingReports;

export const markReportResolved = (reports, reportId) => reports.map(report => report.id === reportId
  ? { ...report, status: "resolved" }
  : report);

export const markReportsResolved = (reports, reportIds) => {
  const selected = new Set(reportIds);
  return reports.map(report => selected.has(report.id) ? { ...report, status: "resolved" } : report);
};

export const resolvedReportsForTarget = (reports, targetReport) => reports
  .filter(report => report.status === "resolved"
    && report.targetType === targetReport?.targetType
    && report.targetId === targetReport?.targetId)
  .sort((left, right) => String(left.id || "").localeCompare(String(right.id || "")));

export const moderationActionAllowed = ({ status, targetType, action, blocked = false }) => status === "pending"
  && !blocked
  && (targetType ? ACTIONS_BY_TARGET[targetType]?.has(action) === true : Object.values(ACTIONS_BY_TARGET).some(actions => actions.has(action)));

const indexedById = records => new Map(records.map(record => [record.id, record]));
const joinedReportRow = (report, target, usersById) => ({
  report,
  target,
  targetExists: Boolean(target),
  targetCollection: moderationTargetCollection(report.targetType),
  reporterUsername: usersById.get(report.reporterId)?.username || "Unknown reporter",
  ownerUsername: usersById.get(report.reportedUserId)?.username || target?.username || "Unknown owner",
  imagePreview: report.targetType === "room" ? { kind: "none" } : postImagePresentation(
    target?.imageData,
    `Image attached to reported ${report.targetType === "communityPost" ? "community" : "timeline"} post`
  ),
  preview: report.targetType === "room"
    ? [target?.name, target?.topic].filter(Boolean).join(" — ") || "Room details unavailable"
    : String(target?.content || (target?.imageData ? "Photo post" : "Post content unavailable")).slice(0, 500)
});

export const reportedPostRows = ({ reports, posts = [], communityPosts = [], users = [] }) => {
  const postsById = indexedById(posts), communityPostsById = indexedById(communityPosts), usersById = indexedById(users);
  return filterPendingReports(reports)
    .filter(report => report.targetType === "post" || report.targetType === "communityPost")
    .map(report => joinedReportRow(report, report.targetType === "post" ? postsById.get(report.targetId) : communityPostsById.get(report.targetId), usersById));
};

export const reportedRoomRows = ({ reports, rooms = [], roomEvidenceByRoom = new Map(), users = [] }) => {
  const roomsById = indexedById(rooms), usersById = indexedById(users);
  return filterPendingReports(reports)
    .filter(report => report.targetType === "room")
    .map(report => {
      const evidence = roomEvidenceByRoom.get(report.targetId) ?? {};
      const messages = [...(evidence.messages ?? [])]
        .sort((left, right) => (timestampMillis(left.createdAt) ?? 0) - (timestampMillis(right.createdAt) ?? 0)
          || String(left.id || "").localeCompare(String(right.id || "")));
      const totalCount = Number.isInteger(evidence.totalCount) && evidence.totalCount >= messages.length
        ? evidence.totalCount
        : messages.length;
      return {
        ...joinedReportRow(report, roomsById.get(report.targetId), usersById),
        messages,
        evidenceTotalCount: totalCount,
        evidenceHasMore: evidence.hasMore === true || messages.length < totalCount,
        evidenceLoading: evidence.loading === true,
        evidenceError: evidence.error ?? null
      };
    });
};

export const roomEvidencePage = (messages, visibleCount = 12, pageSize = 12) => {
  const totalCount = messages.length;
  const boundedVisibleCount = Math.min(totalCount, Math.max(0, visibleCount));
  return {
    messages: messages.slice(0, boundedVisibleCount),
    visibleCount: boundedVisibleCount,
    totalCount,
    hasMore: boundedVisibleCount < totalCount,
    nextVisibleCount: Math.min(totalCount, boundedVisibleCount + pageSize)
  };
};

export const moderationDeletionQueuePlan = ({ report, adminId, timestamp }) => {
  if (report?.status !== "pending") throw new TypeError("A pending report is required");
  if (!moderationTargetCollection(report.targetType) || !report.id || !report.targetId || !adminId || timestamp === undefined) {
    throw new TypeError("A complete moderation deletion request is required");
  }
  return {
    jobId: `${report.targetType}_${report.targetId}`,
    job: {
      targetType: report.targetType,
      targetId: report.targetId,
      reportId: report.id,
      requesterUid: adminId,
      requestedAt: timestamp,
      status: "queued"
    }
  };
};

export const moderationDeletionState = (jobs, report) => {
  const record = jobs.get(`${report.targetType}_${report.targetId}`);
  const status = record?.data?.status ?? record?.status;
  if (!record) return null;
  if (status === "completed") return {
    pending: true,
    failed: false,
    completed: true,
    label: "Deletion completed — this content ID is permanently retired"
  };
  return {
    pending: true,
    failed: status === "failed",
    label: status === "failed" ? "Deletion Pending — retry scheduled" : "Deletion Pending"
  };
};

export const moderationResolutionPlan = ({ report, reports = [report], action, adminId, timestamp, expiresAt }) => {
  if (!moderationActionAllowed({ status: report?.status, targetType: report?.targetType, action })) {
    throw new TypeError("That moderation action is not allowed");
  }
  if (!report?.id || !report.targetId || !adminId || timestamp === undefined) {
    throw new TypeError("A complete moderation action is required");
  }
  if (action === "restore-room" && expiresAt === undefined) {
    throw new TypeError("A fresh room expiry is required");
  }
  const restore = action === "restore-post"
    ? restorePostPayload({ resolvedAt: timestamp })
    : action === "restore-room"
      ? restoreRoomPayload({ resolvedAt: timestamp, expiresAt })
      : null;
  const reportIds = reports
    .filter(candidate => candidate?.status === "pending"
      && candidate.targetType === report.targetType
      && candidate.targetId === report.targetId
      && typeof candidate.id === "string" && candidate.id.length > 0)
    .map(candidate => candidate.id)
    .sort((left, right) => left.localeCompare(right));
  if (!reportIds.includes(report.id)) throw new TypeError("Every restore requires its pending anchor report");
  const reportData = {
    status: "resolved",
    resolvedBy: adminId,
    resolutionAction: action,
    resolvedAt: timestamp
  };
  return {
    markerId: `${report.targetType}_${report.targetId}`,
    marker: {
      targetType: report.targetType,
      targetId: report.targetId,
      reportIds,
      reportCount: reportIds.length,
      action,
      adminId,
      actedAt: timestamp
    },
    reportResolutions: reportIds.map(id => ({ id, data: reportData })),
    targetCollection: moderationTargetCollection(report.targetType),
    target: restore,
    deleteTarget: action === "delete-post" || action === "delete-room"
  };
};

export const deterministicDeletionPages = (records, pageSize = MAX_MODERATION_BATCH_WRITES) => {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_MODERATION_BATCH_WRITES) {
    throw new RangeError(`Moderation deletion pages must contain at most ${MAX_MODERATION_BATCH_WRITES} writes`);
  }
  const ordered = [...records].sort((left, right) => String(left.path || left.ref?.path || "").localeCompare(String(right.path || right.ref?.path || "")));
  const pages = [];
  for (let index = 0; index < ordered.length; index += pageSize) pages.push(ordered.slice(index, index + pageSize));
  return pages;
};

export const hasDeletionJob = (user, deletionJobs = new Map()) => deletionJobs.has(user.id)
  || ["adminDeletionRequestedAt", "adminDeletionRequestedBy", "adminDeletionStatus"].some(key => key in user);

export const statusForUser = (user, { now = Date.now(), deletionJobs = new Map() } = {}) => {
  if (hasDeletionJob(user, deletionJobs)) return { kind: "deletion-pending", label: "Deletion Pending" };
  if (user.banned === true) return { kind: "banned", label: "Banned" };
  const activeAt = timestampMillis(user.lastActiveAt);
  if (activeAt === null) return { kind: "activity-not-recorded", label: "Activity Not Recorded" };
  return now - activeAt >= 7 * DAY_MS
    ? { kind: "inactive", label: "Inactive" }
    : { kind: "active", label: "Active" };
};

export const filterUsers = (users, { filter = "all", search = "", now = Date.now(), deletionJobs = new Map() } = {}) => {
  const needle = String(search).toLowerCase();
  return users.filter(user => {
    const status = statusForUser(user, { now, deletionJobs }).kind;
    return (!needle || String(user.username || "").toLowerCase().includes(needle))
      && (filter === "all" || status === filter);
  });
};

export const sortInactiveUsers = (users, { now = Date.now(), deletionJobs = new Map() } = {}) => filterUsers(users, {
  filter: "inactive", now, deletionJobs
}).sort((left, right) => timestampMillis(left.lastActiveAt) - timestampMillis(right.lastActiveAt));

export const canConfirmDeletion = ({ typedUsername, targetUsername, blocked }) => !blocked
  && typeof targetUsername === "string"
  && typedUsername === targetUsername;

export const deletionJobRecord = (pathId, data, hasPendingWrites) => ({ pathId, data, hasPendingWrites: hasPendingWrites === true });

export const deletionDialogJobTransition = (dialog, job) => {
  if (!dialog.open || job?.pathId !== dialog.targetUid || (dialog.submitting && job.hasPendingWrites)) return dialog;
  return {
    ...dialog,
    open: false,
    feedback: job.data?.status === "failed"
      ? "This account is already locked for permanent deletion and needs attention."
      : "Account locked. Permanent deletion queued."
  };
};

export const queueFailureDialogTransition = (dialog, job) => {
  const confirmed = job && !job.hasPendingWrites ? deletionDialogJobTransition(dialog, job) : dialog;
  return confirmed.open === false
    ? confirmed
    : { ...dialog, open: true, submitting: false, feedback: "Could not queue permanent deletion. No changes were made." };
};

export const resolveUserFocus = ({ activeFocusKey, availableFocusKeys, fallbackFocusKey }) => availableFocusKeys.includes(activeFocusKey)
  ? activeFocusKey
  : fallbackFocusKey;

export const processorHealth = (processor, now = Date.now()) => {
  const updatedAt = timestampMillis(processor?.updatedAt);
  if (!(["started", "completed"].includes(processor?.status)) || updatedAt === null || now < updatedAt) {
    return { kind: "not-running", label: "Not running" };
  }
  const age = now - updatedAt;
  if (age <= PROCESSOR_WORKING_MS) return { kind: "working", label: "Working normally" };
  if (age <= PROCESSOR_DELAYED_MS) return { kind: "delayed", label: "Delayed" };
  return { kind: "not-running", label: "Not running" };
};
