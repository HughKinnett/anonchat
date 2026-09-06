export const DEFAULT_TYPING_TTL_MS = 7000;

export const typingExpiresAt = (nowMs, ttlMs = DEFAULT_TYPING_TTL_MS) =>
  Number(nowMs) + Number(ttlMs);

export const isTypingActive = (typing = {}, nowMs = Date.now()) => {
  const expiresAt = Number(typing?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Number(nowMs);
};
