import { isProtectedAdministrator } from "./admin-deletion-policy.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const PROCESSOR_WORKING_MS = 10 * 60 * 1000;
const PROCESSOR_DELAYED_MS = 20 * 60 * 1000;

export const timestampMillis = value => {
  const millis = value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value);
  return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
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

export const moderationActionsAvailable = ({ listenerHealthy, processor, now = Date.now() } = {}) =>
  listenerHealthy === true && processorHealth(processor, now).kind === "working";

const MODERATION_PREVIEW_LIMIT = 240;
export const MAX_MODERATION_ACTION_ATTEMPTS = 8;
const activeActionStatuses = new Set(["queued", "leased", "processing"]);
const statusFilters = Object.freeze({
  open: new Set(["open", "deleteQueued"]),
  restored: new Set(["restored"]),
  expiredEvidence: new Set(["expiredEvidence"])
});

export const moderationCaseRecord = (pathId, data = {}) => ({
  ...data,
  id: String(pathId),
  preview: typeof data.snapshot?.text === "string"
    ? data.snapshot.text.slice(0, MODERATION_PREVIEW_LIMIT)
    : data.targetKind === "user" ? "Profile report" : "No text preview available."
});

export const moderationTranscriptMessage = (pathId, data = {}) => ({
  id: String(pathId),
  roomId: String(data.roomId ?? ""),
  senderId: String(data.senderId ?? ""),
  authorName: typeof data.tempName === "string" ? data.tempName.slice(0, 100) : "",
  text: typeof data.text === "string" ? data.text.slice(0, 500) : "",
  createdAt: data.createdAt
});

export const generalContentDeletionPayloads = ({ id, type, authorId, requestedBy, requestedAt } = {}) => {
  const targetKind = type === "community" ? "communityPost" : type === "timeline" ? "post" : "";
  const targetCollection = targetKind === "communityPost" ? "communityPosts" : "posts";
  if (!targetKind || typeof id !== "string" || !id || id.includes("/") || typeof authorId !== "string" || !authorId
    || typeof requestedBy !== "string" || !requestedBy || requestedAt === undefined) throw new TypeError("Valid public content is required");
  return {
    id: `${targetKind}_${id}`,
    moderationCase: {
      targetKind, targetCollection, targetId: id, targetPath: `${targetCollection}/${id}`,
      reportedUserId: authorId, snapshot: { kind: "queuedAdminDeletion" }, status: "deleteQueued",
      reportCount: 0, reasonTotals: {}, createdAt: requestedAt, updatedAt: requestedAt
    },
    action: { action: "deleteMaterial", requestedAt, requestedBy, status: "queued" }
  };
};

const evidenceLabels = Object.freeze({
  postImage: "Reported post image",
  profileImage: "Reported profile image",
  coverImage: "Reported profile cover image"
});
export const moderationEvidenceMedia = (item) => (Array.isArray(item?.items) ? item.items : Array.isArray(item?.snapshot?.media) ? item.snapshot.media : [])
  .filter((media) => evidenceLabels[media?.kind]
    && typeof media.dataUrl === "string"
    && media.dataUrl.length <= 780000
    && /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]*={0,2}$/.test(media.dataUrl))
  .slice(0, 2)
  .map((media) => ({ kind: media.kind, dataUrl: media.dataUrl, label: evidenceLabels[media.kind] }));

export const generalContentDeletionWriteMode = ({ caseExists = false, actionExists = false } = {}) =>
  actionExists ? "blocked" : caseExists ? "action-only" : "case-and-action";

export const filterModerationCases = (cases, { filter = "open" } = {}) => cases
  .filter(item => filter === "all" || (statusFilters[filter] || statusFilters.open).has(item.status))
  .sort((left, right) => {
    const timeDifference = (timestampMillis(right.createdAt) ?? timestampMillis(right.updatedAt) ?? 0)
      - (timestampMillis(left.createdAt) ?? timestampMillis(left.updatedAt) ?? 0);
    return timeDifference || String(left.id).localeCompare(String(right.id));
  });

const actionLabel = action => action === "deleteMaterial" ? "Delete material permanently" : "Restore material";

export const isTerminalModerationAction = action => {
  const actionData = action?.data ?? action;
  return ["failed", "terminal"].includes(actionData?.status)
    && Number.isInteger(actionData.attempts)
    && actionData.attempts >= MAX_MODERATION_ACTION_ATTEMPTS;
};

export const resolveReportActionFocus = ({ sourceFocusKey, sameReportFocusKeys = [], availableFocusKeys = [], fallbackFocusKey }) =>
  availableFocusKeys.includes(sourceFocusKey)
    ? sourceFocusKey
    : sameReportFocusKeys.find(key => availableFocusKeys.includes(key)) || fallbackFocusKey;

export const moderationActionState = ({ caseRecord, action, deletionPending = false, username } = {}) => {
  const actionData = action?.data ?? action;
  const actionStatus = actionData?.status;
  const queuedByCase = caseRecord?.status === "deleteQueued";
  const terminalFailure = isTerminalModerationAction(actionData);
  const terminalDeleteRetry = queuedByCase && terminalFailure && actionData?.action === "deleteMaterial";
  const retryableFailure = actionStatus === "failed" && !terminalFailure;
  const locked = (queuedByCase && !terminalDeleteRetry) || activeActionStatuses.has(actionStatus) || retryableFailure || deletionPending;
  const name = actionLabel(actionData?.action ?? (queuedByCase ? "deleteMaterial" : undefined));
  const feedback = terminalDeleteRetry || (terminalFailure && !queuedByCase)
    ? `${name} stopped after repeated failures. Retry this action.`
    : queuedByCase || actionStatus === "queued"
    ? `${name} queued.`
    : ["leased", "processing"].includes(actionStatus)
      ? `${name} is being processed.`
      : retryableFailure
        ? `${name} needs attention and will retry.`
        : "";
  const protectedAdmin = isProtectedAdministrator(typeof username === "string" ? username : caseRecord?.snapshot?.authorName);
  return {
    locked,
    feedback,
    restore: { disabled: locked || caseRecord?.status !== "open" || (terminalFailure && actionData?.action !== "restore") },
    deleteMaterial: { disabled: locked || caseRecord?.targetKind === "user" || (terminalFailure && actionData?.action !== "deleteMaterial") },
    ban: { disabled: locked || terminalFailure || protectedAdmin },
    deleteProfile: { disabled: locked || terminalFailure || protectedAdmin }
  };
};

export const moderationActionPayload = ({ caseRecord, action, requestedBy, requestedAt } = {}) => {
  if (!caseRecord?.id || !["restore", "deleteMaterial"].includes(action)
    || typeof requestedBy !== "string" || requestedBy.trim().length === 0 || requestedAt === undefined) {
    throw new TypeError("A valid moderation action is required");
  }
  if ((action === "restore" && caseRecord.status === "expiredEvidence")
    || (action === "deleteMaterial" && caseRecord.targetKind === "user")) {
    throw new TypeError("That action is unavailable for this report");
  }
  return { action, requestedAt, requestedBy, status: "queued" };
};

export const moderationActionRetryPayload = ({ caseRecord, action, existingAction, requestedAt } = {}) => {
  const actionData = existingAction?.data ?? existingAction;
  if (!caseRecord?.id || !["restore", "deleteMaterial"].includes(action)
    || !isTerminalModerationAction(actionData) || actionData.action !== action
    || typeof actionData.requestedBy !== "string" || actionData.requestedBy.trim().length === 0 || requestedAt === undefined) {
    throw new TypeError("A terminal moderation action retry is required");
  }
  return { action, requestedAt, requestedBy: actionData.requestedBy, status: "queued" };
};

export const legacyRoomActionPayload = ({ roomId, action, requestedBy, requestedAt } = {}) => {
  if (typeof roomId !== "string" || roomId.length === 0 || roomId.includes("/")
    || !["retryCleanup", "approveCleanup", "release"].includes(action)
    || typeof requestedBy !== "string" || requestedBy.length === 0 || requestedAt === undefined) {
    throw new TypeError("A valid legacy-room review action is required");
  }
  return { roomId, action, requestedAt, requestedBy, status: "queued" };
};
