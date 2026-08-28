const TEXT = Object.freeze({
  reaction: "Someone reacted to your post.",
  comment: "Someone commented on your post.",
  "message-request": "You have a new private conversation request.",
  "room-message": "A temporary room you joined has a new message.",
  "reveal-request": "You have a new mutual reveal request."
});
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

const item = (type, source, extra = {}) => {
  const data = dataOf(source);
  return {
    id: notificationUiId(type, pathOf(source) || source.id, data.createdAt),
    type,
    createdAt: data.createdAt,
    message: TEXT[type],
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
  reveals = [],
  nowMillis = Date.now()
}) => {
  if (typeof currentUid !== "string" || !currentUid) return [];
  const ownedPostIds = new Set(posts.filter((post) => {
    const data = dataOf(post);
    return data.type !== "repost" && data.authorId === currentUid;
  }).map((post) => post.id));
  const joinedRoomIds = new Set(roomMemberships.map((membership) => dataOf(membership).roomId));
  const items = [];
  reactions.forEach((reaction) => {
    const data = dataOf(reaction);
    const postId = sourceParentId(reaction);
    if (data.uid !== currentUid && ownedPostIds.has(postId)) items.push(item("reaction", reaction, { postId }));
  });
  comments.forEach((comment) => {
    const data = dataOf(comment);
    const postId = sourceParentId(comment);
    if (data.uid !== currentUid && ownedPostIds.has(postId)) items.push(item("comment", comment, { postId }));
  });
  messageRequests.forEach((request) => {
    const data = dataOf(request);
    if (data.toId === currentUid && data.fromId !== currentUid && data.status === "pending") items.push(item("message-request", request));
  });
  roomMessages.forEach((message) => {
    const data = dataOf(message);
    if (data.senderId !== currentUid && joinedRoomIds.has(data.roomId) && timestampMillis(data.expiresAt) > nowMillis) {
      items.push(item("room-message", message));
    }
  });
  reveals.forEach((reveal) => {
    const data = dataOf(reveal);
    if (data.toId === currentUid && data.fromId !== currentUid && data.status === "pending") items.push(item("reveal-request", reveal));
  });
  return items.sort((left, right) => timestampMillis(right.createdAt) - timestampMillis(left.createdAt));
};

export const inAppNotificationText = (type) => TEXT[type];
