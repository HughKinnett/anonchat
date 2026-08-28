export const isTrustedTimestamp = (value) => typeof value?.toMillis === "function";

export const isCompleteLegacyProfile = (profile, uid, username) => Boolean(
  profile
  && profile.uid === uid
  && profile.username === username
  && isTrustedTimestamp(profile.createdAt)
  && isTrustedTimestamp(profile.lastActiveAt)
);

export const migrateLegacyProfile = ({ profile = {}, uid, username, serverTimestamp }) => ({
  uid,
  username,
  createdAt: isTrustedTimestamp(profile.createdAt) ? profile.createdAt : serverTimestamp(),
  lastActiveAt: isTrustedTimestamp(profile.lastActiveAt) ? profile.lastActiveAt : serverTimestamp()
});
