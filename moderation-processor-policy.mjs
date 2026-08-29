export const LEASE_MS = 4 * 60 * 1000;
export const PAGE_SIZE = 100;
export const MAX_ATTEMPTS = 8;
export const SNAPSHOT_TEXT_LIMIT = 500;
export const SNAPSHOT_MEDIA_LIMIT = 780000;
export const LEGACY_ROOM_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export const timestampToMillis = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return Number.NaN;
};
export const caseId = (targetKind, targetId) => `${targetKind}_${encodeURIComponent(String(targetId))}`;
const isSafeId = (value) => typeof value === "string" && value.length > 0 && !value.includes("/") && value !== "." && value !== "..";
const collections = Object.freeze({ post: "posts", communityPost: "communityPosts", room: "rooms", roomMessage: "roomMessages", user: "users" });
export const isValidModerationIntake = (id, intake) => {
  if (!intake || !REPORT_TARGETS.includes(intake.targetKind) || collections[intake.targetKind] !== intake.targetCollection
    || !isSafeId(intake.reporterUid) || !isSafeId(intake.reportedUserId) || !isSafeId(intake.targetId)
    || intake.targetPath !== `${intake.targetCollection}/${intake.targetId}` || !REPORT_REASONS.includes(intake.reason)
    || intake.reporterUid === intake.reportedUserId || (intake.targetKind === "user" && intake.targetId !== intake.reportedUserId)) return false;
  try { return id === reportId(intake.reporterUid, intake.targetKind, intake.targetId); } catch { return false; }
};
export const restoreOutcome = (item, source, nowMillis) => {
  const sourceData = typeof source?.data === "function" ? source.data() : source?.data;
  const invalid = item?.status === "expiredEvidence" || !source?.exists
    || (item?.targetKind === "roomMessage" && timestampToMillis(sourceData?.expiresAt) <= nowMillis);
  return invalid ? "expired" : "restored";
};
export const retryDelayMillis = (attempts) => Math.min(60_000, 1_000 * (2 ** Math.max(0, Math.min(MAX_ATTEMPTS - 1, attempts - 1))));
export const isLeaseEligible = (record, nowMillis) => record?.status === "queued"
  || (record?.status === "failed" && timestampToMillis(record.nextAttemptAt) <= nowMillis)
  || (record?.status === "processing" && timestampToMillis(record.leaseExpiresAt) <= nowMillis);
export const isTerminalModerationRecord = (record) => record?.status === "failed"
  && Number.isInteger(record.attempts) && record.attempts >= MAX_ATTEMPTS;
const boundedText = (value) => typeof value === "string" ? value.slice(0, SNAPSHOT_TEXT_LIMIT) : "";
const boundedName = (value) => typeof value === "string" ? value.slice(0, 100) : "";
const safeImageDataUrl = (value) => typeof value === "string"
  && value.length <= SNAPSHOT_MEDIA_LIMIT
  && /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]*={0,2}$/.test(value);
const boundedMedia = (entries) => {
  let retained = 0;
  return entries.flatMap(({ kind, value }) => {
    if (!safeImageDataUrl(value) || retained + value.length > SNAPSHOT_MEDIA_LIMIT) return [];
    retained += value.length;
    return [{ kind, dataUrl: value }];
  });
};
export const snapshotForTarget = (kind, data) => {
  if (!data || typeof data !== "object") throw Object.assign(new Error("unsupported-target"), { code: "unsupported-target" });
  if (kind === "post") return { kind, authorId: String(data.authorId ?? ""), authorName: boundedName(data.username), text: boundedText(data.content), media: boundedMedia([{ kind: "postImage", value: data.imageData }]), category: boundedName(data.category) };
  if (kind === "communityPost") return { kind, authorId: String(data.authorId ?? ""), authorName: boundedName(data.username), text: boundedText(data.content), category: boundedName(data.category), optionCount: Array.isArray(data.options) ? Math.min(4, data.options.length) : 0 };
  if (kind === "room") return { kind, authorId: String(data.ownerId ?? ""), authorName: boundedName(data.name), text: boundedText(data.topic), createdAt: data.createdAt, expiresAt: data.expiresAt };
  if (kind === "roomMessage") return { kind, authorId: String(data.senderId ?? ""), authorName: boundedName(data.tempName), text: boundedText(data.text), roomId: String(data.roomId ?? ""), expiresAt: data.expiresAt };
  if (kind === "user") return { kind, authorId: String(data.uid ?? ""), authorName: boundedName(data.username), media: boundedMedia([{ kind: "profileImage", value: data.profileImage }, { kind: "coverImage", value: data.coverImage }]) };
  throw Object.assign(new Error("unsupported-target"), { code: "unsupported-target" });
};
export const redactedSummary = ({ inspected = 0, processed = 0, failed = 0, skipped = 0, terminalIntakes = 0, terminalActions = 0, expiredRooms = 0, backfilled = 0, roomLifecycleMigrated = 0, roomLifecycleQuarantined = 0, roomLifecycleDeferred = 0, legacyRoomsCleaned = 0, legacyRoomsManualReview = 0 }) =>
  `MODERATION_RESULT inspected=${inspected} processed=${processed} failed=${failed} skipped=${skipped} terminalIntakes=${terminalIntakes} terminalActions=${terminalActions} expiredRooms=${expiredRooms} backfilled=${backfilled} roomLifecycleMigrated=${roomLifecycleMigrated} roomLifecycleQuarantined=${roomLifecycleQuarantined} roomLifecycleDeferred=${roomLifecycleDeferred} legacyRoomsCleaned=${legacyRoomsCleaned} legacyRoomsManualReview=${legacyRoomsManualReview}`;
export const fixedErrorCode = (error) => {
  const code = error?.code;
  const firestoreCodes = new Map([
    [3, "FIRESTORE_INVALID_ARGUMENT"],
    [7, "FIRESTORE_PERMISSION_DENIED"],
    [8, "FIRESTORE_RESOURCE_EXHAUSTED"],
    [9, "FIRESTORE_FAILED_PRECONDITION"],
    [10, "FIRESTORE_ABORTED"],
    [13, "FIRESTORE_INTERNAL"],
    [14, "FIRESTORE_UNAVAILABLE"],
    ["invalid-argument", "FIRESTORE_INVALID_ARGUMENT"],
    ["permission-denied", "FIRESTORE_PERMISSION_DENIED"],
    ["resource-exhausted", "FIRESTORE_RESOURCE_EXHAUSTED"],
    ["failed-precondition", "FIRESTORE_FAILED_PRECONDITION"],
    ["aborted", "FIRESTORE_ABORTED"],
    ["internal", "FIRESTORE_INTERNAL"],
    ["unavailable", "FIRESTORE_UNAVAILABLE"]
  ]);
  if (firestoreCodes.has(code)) return firestoreCodes.get(code);
  return new Set(["invalid-intake", "unsupported-target", "lease-lost", "action-invalid", "action-limit", "source-unavailable", "heartbeat-failed", "expired-evidence", "unsettled-intake"]).has(code) ? code.toUpperCase().replaceAll("-", "_") : "PROCESSOR_FAILURE";
};
import { REPORT_REASONS, REPORT_TARGETS, reportId } from "./moderation-policy.mjs";
