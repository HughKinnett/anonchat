export const MESSAGE_REACTIONS = Object.freeze(["❤️", "👍", "😂", "😮", "😢", "🔥"]);
export const TYPING_TTL_MS = 12_000;
export const UNSEND_WINDOW_MS = 15 * 60 * 1000;
export const GROUP_MEMBER_LIMIT = 20;

export const normalizeMessageReaction = (value) => MESSAGE_REACTIONS.includes(value) ? value : "";

export const normalizeReplyReference = (value = {}) => ({
  messageId: String(value.messageId || "").trim().slice(0, 160),
  senderId: String(value.senderId || "").trim().slice(0, 160)
});

const createdMillis = (value) => {
  if (typeof value === "number") return value;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  return 0;
};

export const canUnsendMessage = (message = {}, viewerUid = "", now = Date.now()) =>
  Boolean(viewerUid && message.senderId === viewerUid && createdMillis(message.createdAt) > 0
    && now - createdMillis(message.createdAt) <= UNSEND_WINDOW_MS);

export const typingIsActive = (typing = {}, now = Date.now()) => {
  const updated = createdMillis(typing.updatedAt);
  return Boolean(typing.active && updated && now - updated <= TYPING_TTL_MS);
};

export const normalizeGroupName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 60);
export const normalizeGroupMemberIds = (ownerId, values = []) => [ownerId, ...(Array.isArray(values) ? values : [])]
  .map((value) => String(value || "").trim()).filter(Boolean)
  .filter((value, index, list) => list.indexOf(value) === index)
  .slice(0, GROUP_MEMBER_LIMIT);

export const groupCanRead = (group = {}, uid = "") => Boolean(uid && Array.isArray(group.memberIds) && group.memberIds.includes(uid));
export const groupCanManage = (group = {}, uid = "") => Boolean(uid && group.ownerId === uid);
