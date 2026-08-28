export const PROTECTED_LEGACY_USERNAMES = Object.freeze([
  "i_love_you_h",
  "cybercapone"
]);

const codedError = (code) => Object.assign(new Error(code), { code });
export const isTrustedTimestamp = (value) => typeof value?.toMillis === "function";
export const normalizeLegacyUsername = (value) => typeof value === "string"
  ? value.trim().toLowerCase()
  : "";
export const isProtectedLegacyUsername = (value) =>
  PROTECTED_LEGACY_USERNAMES.includes(normalizeLegacyUsername(value));

export const parseProtectedUidMap = (source = "") => {
  if (source === undefined || source === null || source === "") return {};
  let parsed;
  try { parsed = JSON.parse(source); }
  catch { throw codedError("invalid-protected-uid-map"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw codedError("invalid-protected-uid-map");
  }
  const normalized = {};
  for (const [username, uid] of Object.entries(parsed)) {
    const key = normalizeLegacyUsername(username);
    if (!PROTECTED_LEGACY_USERNAMES.includes(key) || typeof uid !== "string" || !uid.trim()
      || Object.hasOwn(normalized, key)) throw codedError("invalid-protected-uid-map");
    normalized[key] = uid.trim();
  }
  return normalized;
};

export const assertProtectedUidMapping = (username, uid, protectedUidMap = {}) => {
  const normalized = normalizeLegacyUsername(username);
  if (PROTECTED_LEGACY_USERNAMES.includes(normalized) && protectedUidMap[normalized] !== uid) {
    throw codedError("protected-uid-mapping-required");
  }
};

export const isCompleteLegacyProfile = (profile, uid, username) => Boolean(
  profile
  && profile.uid === uid
  && profile.username === username
  && isTrustedTimestamp(profile.createdAt)
);

export const createLegacyProfile = ({ uid, username, serverTimestamp }) => ({
  uid,
  username,
  createdAt: serverTimestamp(),
  lastActiveAt: serverTimestamp()
});

export const repairLegacyProfile = ({ profile = {}, uid, username, serverTimestamp }) => {
  const repair = {};
  if (profile.uid !== uid) repair.uid = uid;
  if (profile.username !== username) repair.username = username;
  if (!isTrustedTimestamp(profile.createdAt)) repair.createdAt = serverTimestamp();
  return repair;
};

export const migrateLegacyProfile = ({ uid, username, serverTimestamp }) =>
  createLegacyProfile({ uid, username, serverTimestamp });
