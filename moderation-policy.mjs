export const DAY_MS = 86_400_000;

export const blockId = (blockerId, blockedId) => `${blockerId}_${blockedId}`;

export const reportId = (kind, targetId, reporterId) => `${kind}_${targetId}_${reporterId}`;

const pairContainsActor = (pair, actorId) => {
  if (typeof pair === "string") {
    return pair === actorId
      || pair.startsWith(`${actorId}_`)
      || pair.endsWith(`_${actorId}`);
  }
  if (Array.isArray(pair)) return pair.includes(actorId);
  return pair?.blockerId === actorId || pair?.blockedId === actorId;
};

export const canShowActorContent = (actorId, blockedPairs) => {
  if (!actorId || !blockedPairs) return true;
  const pairs = typeof blockedPairs === "string"
    ? [blockedPairs]
    : typeof blockedPairs[Symbol.iterator] === "function"
    ? blockedPairs
    : [blockedPairs];
  for (const pair of pairs) {
    if (pairContainsActor(pair, actorId)) return false;
  }
  return true;
};

export const postIsVisible = (post, now) => post?.moderationStatus !== "reported"
  && (!post?.expiresAt?.toMillis || post.expiresAt.toMillis() > now);

export const roomState = (room, now) => room?.moderationStatus === "reported"
  ? "reported" : room?.expiresAt?.toMillis?.() <= now ? "expired" : "active";

const requiredString = (input, names, label) => {
  for (const name of names) {
    if (typeof input?.[name] === "string" && input[name].trim().length > 0) return input[name];
  }
  throw new TypeError(`A ${label} is required`);
};

const requiredValue = (input, names, label) => {
  for (const name of names) {
    if (input?.[name] !== undefined) return input[name];
  }
  throw new TypeError(`A ${label} is required`);
};

const reportPayloads = (input, targetType, targetKey) => {
  const targetId = requiredString(input, ["targetId", `${targetType}Id`], `${targetType} ID`);
  const reporterId = requiredString(input, ["reporterId"], "reporter ID");
  const reportedUserId = requiredString(input, [
    "reportedUserId",
    targetType === "post" || targetType === "communityPost" ? "authorId" : "ownerId",
    targetType === "post" || targetType === "communityPost" ? "postAuthorId" : "roomOwnerId"
  ], `${targetType} owner ID`);
  const reason = requiredString(input, ["reason"], "report reason");
  const timestamp = requiredValue(input, ["timestamp", "createdAt", "reportedAt"], "trusted timestamp");

  return {
    report: {
      targetType,
      targetId,
      reporterId,
      reportedUserId,
      reason,
      status: "pending",
      createdAt: timestamp
    },
    [targetKey]: {
      moderationStatus: "reported",
      reportedAt: timestamp
    }
  };
};

export const postReportPayloads = (input) => reportPayloads(input, "post", "post");

export const communityPostReportPayloads = (input) =>
  reportPayloads(input, "communityPost", "communityPost");

export const roomReportPayloads = (input) => reportPayloads(input, "room", "room");

export const restorePostPayload = () => ({
  moderationStatus: "active",
  reportedAt: null
});

export const restoreRoomPayload = ({ resolvedAt, expiresAt }) => ({
  moderationStatus: "active",
  reportedAt: null,
  resumedAt: resolvedAt,
  expiresAt
});
