export const MAX_CONSECUTIVE_FAILURES = 3;
const PREFIX = "anonchat.authFailures.v1.";

const emailKey = (email) => {
  const normalized = String(email || "").trim().toLowerCase();
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${PREFIX}${(hash >>> 0).toString(36)}`;
};

export const failureState = (storage, email) => {
  try {
    const value = JSON.parse(storage.getItem(emailKey(email)) || "null");
    return {
      count: Number.isInteger(value?.count) ? Math.max(0, value.count) : 0,
      resetRequired: value?.resetRequired === true
    };
  } catch {
    return { count: 0, resetRequired: false };
  }
};

export const recordInvalidCredential = (storage, email) => {
  const previous = failureState(storage, email);
  const count = Math.min(MAX_CONSECUTIVE_FAILURES, previous.count + 1);
  const next = { count, resetRequired: count >= MAX_CONSECUTIVE_FAILURES };
  storage.setItem(emailKey(email), JSON.stringify(next));
  return next;
};

export const clearFailures = (storage, email) => storage.removeItem(emailKey(email));

export const isDesignatedAdmin = (username) =>
  ["i_love_you_h", "cybercapone"].includes(String(username || "").trim().toLowerCase());
