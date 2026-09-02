const REACTION_EMOJI = Object.freeze({ wow: "😮", middle_finger: "🖕", laugh: "😂", smile: "😊", fire: "🔥", heart: "❤️", sad: "😢" });
const ROUTES = Object.freeze({
  reaction: "timeline.html",
  comment: "timeline.html",
  "message-request": "community.html#messages-panel",
  "room-message": "community.html#rooms-panel",
  "reveal-request": "community.html#messages-panel"
});
const timestampMillis = (value) => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : Number(value) || 0);
const dataOf = (entry) => entry?.data?.() ?? entry?.data ?? {};
const pathOf = (entry) => entry?.ref?.path ?? entry?.path ?? "";
const sourceParentId = (entry) => pathOf(entry).split("/").at(-3) ?? "";

const fnv = (value, seed) => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const notificationUiId = (type, sourceId, createdAt) => {
  const input = `${type}\u0000${sourceId}\u0000${timestampMillis(createdAt)}`;
  return `event-${fnv(input, 2166136261)}${fnv(input, 3339675911)}`;
};

const cleanLabel = (value) => {
  const label = String(value || "").trim().replace(/^@+/, "");
  return label && label.length <= 40 ? label : "Someone";
};
const actorName = (actorNames, uid, fallback) => cleanLabel(
  fallback || (actorNames instanceof Map ? actorNames.get(uid) : actorNames?.[uid])
);
const messageFor = (type, data, label) => {
  const actor = label === "Someone" ? "Someone" : `@${label}`;
  if (type === "reaction") return `${actor} reacted ${REACTION_EMOJI[data.type] || ""} to your post.`.replace("  ", " ");
  if (type === "comment") return `${actor} commented on your post.`;
  if (type === "message-request") return `${actor} sent you a private conversation request.`;
  if (type === "room-message") return `${actor} sent a message in a temporary room.`;
  if (type === "reveal-request") return `${actor} sent you a mutual reveal request.`;
  return `${actor} sent you a notification.`;
};

const item = (type, source, actorNames, extra = {}) => {
  const data = dataOf(source);
  const actorUid = type === "reaction" || type === "comment" ? data.uid
    : type === "room-message" ? data.senderId : data.fromId;
  const fallback = type === "comment" ? data.username : type === "room-message" ? data.tempName : "";
  const actorLabel = actorName(actorNames, actorUid, fallback);
  return {
    id: notificationUiId(type, pathOf(source) || source.id, data.createdAt),
    type,
    createdAt: data.createdAt,
    actorUid,
    actorLabel,
    message: messageFor(type, data, actorLabel),
    url: ROUTES[type],
    ...extra
  };
};

export const buildInAppNotifications = ({
  currentUid,
  posts = [],
  reactions = [],
  comments = [],
  messageRequests = [],
  roomMessages = [],
  roomMemberships = [],
  blockedUids = [],
  reveals = [],
  actorNames = new Map(),
  nowMillis = Date.now()
}) => {
  if (typeof currentUid !== "string" || !currentUid) return [];
  const ownedPostIds = new Set(posts.filter((post) => {
    const data = dataOf(post);
    return data.type !== "repost" && data.authorId === currentUid;
  }).map((post) => post.id));
  const joinedRoomIds = new Set(roomMemberships.map((membership) => dataOf(membership).roomId));
  const blocked = new Set(blockedUids);
  const items = [];
  reactions.forEach((reaction) => {
    const data = dataOf(reaction);
    const postId = sourceParentId(reaction);
    if (data.uid !== currentUid && !blocked.has(data.uid) && ownedPostIds.has(postId)) items.push(item("reaction", reaction, actorNames, { postId }));
  });
  comments.forEach((comment) => {
    const data = dataOf(comment);
    const postId = sourceParentId(comment);
    if (data.uid !== currentUid && !blocked.has(data.uid) && ownedPostIds.has(postId)) items.push(item("comment", comment, actorNames, { postId }));
  });
  messageRequests.forEach((request) => {
    const data = dataOf(request);
    if (data.toId === currentUid && data.fromId !== currentUid && !blocked.has(data.fromId) && data.status === "pending") items.push(item("message-request", request, actorNames));
  });
  roomMessages.forEach((message) => {
    const data = dataOf(message);
    if (data.senderId !== currentUid && !blocked.has(data.senderId)
      && joinedRoomIds.has(data.roomId) && timestampMillis(data.expiresAt) > nowMillis) {
      items.push(item("room-message", message, actorNames));
    }
  });
  reveals.forEach((reveal) => {
    const data = dataOf(reveal);
    if (data.toId === currentUid && data.fromId !== currentUid && !blocked.has(data.fromId) && data.status === "pending") items.push(item("reveal-request", reveal, actorNames));
  });
  return items.sort((left, right) => timestampMillis(right.createdAt) - timestampMillis(left.createdAt));
};

export const inAppNotificationText = (type, actorLabel = "Someone", data = {}) => messageFor(type, data, cleanLabel(actorLabel));
