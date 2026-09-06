export const MESSAGE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "😡", "🖕"];

export const normalizeMessageReaction = (value) =>
  MESSAGE_REACTIONS.includes(value) ? value : null;

export const nextMessageReaction = (current, selected) => {
  const normalized = normalizeMessageReaction(selected);
  if (!normalized) throw new TypeError("Unsupported reaction");
  return current === normalized ? null : normalized;
};
