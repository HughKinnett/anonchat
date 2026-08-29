export const REPORT_REASONS = Object.freeze([
  "harassment",
  "hate-threats",
  "sexual-content",
  "spam-scam",
  "privacy-impersonation",
  "other"
]);

export const REPORT_TARGETS = Object.freeze(["post", "communityPost", "roomMessage", "user"]);

const TARGET_COLLECTIONS = Object.freeze({
  post: "posts",
  communityPost: "communityPosts",
  roomMessage: "roomMessages",
  user: "users"
});

const isIdentifier = (value) => typeof value === "string" && value.length > 0;

const isDocumentId = (value) => isIdentifier(value)
  && !value.includes("/")
  && value !== "."
  && value !== "..";

const escapedIdentifier = (value, label) => {
  if (!isIdentifier(value)) throw new Error(`invalid ${label}`);
  return encodeURIComponent(value);
};

const assertTargetKind = (targetKind) => {
  if (!REPORT_TARGETS.includes(targetKind)) throw new Error("invalid report target");
};

export const blockId = (blockerUid, blockedUid) => {
  if (!isIdentifier(blockerUid) || !isIdentifier(blockedUid)) throw new Error("invalid block uid");
  if (blockerUid === blockedUid) throw new Error("self block is not allowed");
  return `${escapedIdentifier(blockerUid, "blocker uid")}_${escapedIdentifier(blockedUid, "blocked uid")}`;
};

export const reportId = (reporterUid, targetKind, targetId) => {
  if (!isIdentifier(reporterUid)) throw new Error("invalid report identifier");
  if (!isDocumentId(targetId)) throw new Error("invalid target id");
  assertTargetKind(targetKind);
  if (targetKind === "user" && reporterUid === targetId) throw new Error("self report is not allowed");
  return `${escapedIdentifier(reporterUid, "reporter uid")}_${targetKind}_${escapedIdentifier(targetId, "target id")}`;
};

export const reportIntakePayload = (input) => {
  const {
    reporterUid,
    targetKind,
    targetCollection,
    targetId,
    reportedUserId,
    reason,
    timestamp
  } = input ?? {};

  if (!isIdentifier(reporterUid) || !isIdentifier(reportedUserId)) {
    throw new Error("invalid report identifier");
  }
  if (!isDocumentId(targetId)) throw new Error("invalid target id");
  assertTargetKind(targetKind);
  if (targetCollection !== TARGET_COLLECTIONS[targetKind]) throw new Error("invalid target collection");
  if (!REPORT_REASONS.includes(reason)) throw new Error("invalid report reason");
  if (reporterUid === reportedUserId || (targetKind === "user" && reporterUid === targetId)) {
    throw new Error("self report is not allowed");
  }
  if (targetKind === "user" && targetId !== reportedUserId) throw new Error("user target must match reported user");

  return {
    reporterUid,
    targetKind,
    targetCollection,
    targetId,
    targetPath: `${targetCollection}/${targetId}`,
    reportedUserId,
    reason,
    createdAt: timestamp,
    status: "queued"
  };
};

export const roomExpiry = (nowMillis) => {
  if (!Number.isFinite(nowMillis)) throw new Error("invalid room time");
  return nowMillis + 24 * 60 * 60 * 1000;
};

const timestampMillis = (timestamp) => {
  try {
    const millis = typeof timestamp?.toMillis === "function"
      ? timestamp.toMillis()
      : timestamp instanceof Date
        ? timestamp.getTime()
        : timestamp;
    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
};

export const isRoomActive = (room, nowMillis) => {
  const expiresAt = timestampMillis(room?.expiresAt);
  return Number.isFinite(nowMillis) && expiresAt !== null && expiresAt > nowMillis;
};
