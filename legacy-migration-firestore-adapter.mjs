import {
  assertProtectedUidMapping,
  createLegacyProfile,
  isProtectedLegacyUsername,
  isTrustedTimestamp,
  normalizeLegacyUsername,
  repairLegacyProfile
} from "./legacy-migration-policy.mjs";

const ACCOUNT_LIMIT = 500;
const codedError = (code) => Object.assign(new Error(code), { code });
const validUsername = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_]{3,30}$/.test(value);
const validStats = (value) => value
  && Number.isInteger(value.count)
  && value.count >= 0
  && value.count < ACCOUNT_LIMIT
  && value.limit === ACCOUNT_LIMIT
  && isTrustedTimestamp(value.updatedAt);

export const migrateLegacyAccount = async ({ db, FieldValue, user, protectedUidMap = {} }) => {
  if (!user || typeof user.uid !== "string" || !user.uid) throw codedError("invalid-auth-user");
  return db.runTransaction(async (transaction) => {
    const profileRef = db.doc(`users/${user.uid}`);
    const statsRef = db.doc("system/accountStats");
    const profileSnapshot = await transaction.get(profileRef);
    const existed = profileSnapshot.exists;
    const profile = existed ? profileSnapshot.data() : {};
    const originalProtectedUsername = existed && isProtectedLegacyUsername(profile.username)
      ? profile.username
      : undefined;
    if (originalProtectedUsername) {
      assertProtectedUidMapping(originalProtectedUsername, user.uid, protectedUidMap);
    }
    const hasValidProfileUsername = validUsername(profile.username);
    const hasProtectedDisplayName = isProtectedLegacyUsername(user.displayName);
    const preferred = originalProtectedUsername
      ?? (hasValidProfileUsername
      ? profile.username
      : validUsername(user.displayName)
        ? user.displayName
        : hasProtectedDisplayName
          ? normalizeLegacyUsername(user.displayName)
        : `anon_${user.uid.slice(0, 8)}`);
    const fallback = `u_${user.uid}`;
    if (!validUsername(preferred) && !originalProtectedUsername) {
      throw codedError("invalid-legacy-username");
    }

    const preferredKey = isProtectedLegacyUsername(preferred)
      ? normalizeLegacyUsername(preferred)
      : preferred.toLowerCase();
    const preferredRef = db.doc(`usernames/${preferredKey}`);
    const fallbackRef = db.doc(`usernames/${fallback.toLowerCase()}`);
    const preferredSnapshot = await transaction.get(preferredRef);
    const fallbackSnapshot = preferred.toLowerCase() === fallback.toLowerCase()
      ? preferredSnapshot
      : await transaction.get(fallbackRef);
    if (originalProtectedUsername && (!preferredSnapshot.exists
      || preferredSnapshot.data().uid !== user.uid
      || preferredSnapshot.data().username !== originalProtectedUsername)) {
      throw codedError("protected-reservation-mismatch");
    }
    const preferredOwnedOrAvailable = !preferredSnapshot.exists || preferredSnapshot.data().uid === user.uid;
    if (existed && hasValidProfileUsername && !preferredOwnedOrAvailable) {
      throw codedError("username-reservation-conflict");
    }
    const username = preferredOwnedOrAvailable ? preferred : fallback;
    if (!validUsername(username) && !isProtectedLegacyUsername(username)) {
      throw codedError("invalid-legacy-username");
    }
    const usernameRef = preferredOwnedOrAvailable ? preferredRef : fallbackRef;
    const usernameSnapshot = preferredOwnedOrAvailable ? preferredSnapshot : fallbackSnapshot;
    if (usernameSnapshot.exists && usernameSnapshot.data().uid !== user.uid) {
      throw codedError("username-reservation-conflict");
    }
    assertProtectedUidMapping(username, user.uid, protectedUidMap);

    const adminDeletionRef = db.doc(`adminDeletionJobs/${user.uid}`);
    const selfDeletionRef = db.doc(`accountDeletionRequests/${user.uid}`);
    const statsSnapshot = existed ? undefined : await transaction.get(statsRef);
    const adminDeletionSnapshot = existed ? undefined : await transaction.get(adminDeletionRef);
    const selfDeletionSnapshot = existed ? undefined : await transaction.get(selfDeletionRef);
    if (!existed && (adminDeletionSnapshot.exists || selfDeletionSnapshot.exists)) {
      throw codedError("account-deletion-in-progress");
    }
    if (!existed && (!statsSnapshot.exists || !validStats(statsSnapshot.data()))) {
      throw codedError("account-stats-invalid");
    }

    let changed = false;
    if (!usernameSnapshot.exists) {
      transaction.create(usernameRef, {
        uid: user.uid,
        username,
        createdAt: FieldValue.serverTimestamp()
      });
      changed = true;
    }
    if (existed) {
      const repair = repairLegacyProfile({
        profile,
        uid: user.uid,
        username,
        serverTimestamp: () => FieldValue.serverTimestamp()
      });
      if (Object.keys(repair).length) {
        transaction.set(profileRef, repair, { merge: true });
        changed = true;
      }
    } else {
      transaction.create(profileRef, createLegacyProfile({
        uid: user.uid,
        username,
        serverTimestamp: () => FieldValue.serverTimestamp()
      }));
      transaction.update(statsRef, {
        count: statsSnapshot.data().count + 1,
        limit: ACCOUNT_LIMIT,
        updatedAt: FieldValue.serverTimestamp()
      });
      changed = true;
    }
    return { username, existed, changed };
  });
};
