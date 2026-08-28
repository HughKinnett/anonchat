import { ensureDefaultOwnerFollows } from "./default-follows.js";
import { updateProfile } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const validUsername = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_]{3,30}$/.test(value);

export const ensureUserProfile = async (user, db) => {
  let username;

  await runTransaction(db, async (transaction) => {
    const profileRef = doc(db, "users", user.uid);
    const statsRef = doc(db, "system", "accountStats");
    const profileSnapshot = await transaction.get(profileRef);
    const statsSnapshot = await transaction.get(statsRef);
    const legacyUsername = profileSnapshot.exists() ? profileSnapshot.data().username : "";
    const preferred = validUsername(legacyUsername)
      ? legacyUsername
      : validUsername(user.displayName)
        ? user.displayName
        : `anon_${user.uid.slice(0, 8)}`;
    const fallback = `u_${user.uid}`;
    const preferredRef = doc(db, "usernames", preferred.toLowerCase());
    const fallbackRef = doc(db, "usernames", fallback.toLowerCase());
    const preferredSnapshot = await transaction.get(preferredRef);
    const fallbackSnapshot = preferred.toLowerCase() === fallback.toLowerCase()
      ? preferredSnapshot
      : await transaction.get(fallbackRef);

    const preferredAvailable =
      !preferredSnapshot.exists() || preferredSnapshot.data().uid === user.uid;
    username = preferredAvailable ? preferred : fallback;
    const usernameRef = preferredAvailable ? preferredRef : fallbackRef;
    const usernameSnapshot = preferredAvailable ? preferredSnapshot : fallbackSnapshot;

    if (usernameSnapshot.exists() && usernameSnapshot.data().uid !== user.uid) {
      throw new Error("Could not reserve a unique legacy username.");
    }

    if (!usernameSnapshot.exists()) {
      transaction.set(usernameRef, {
        uid: user.uid,
        username,
        createdAt: serverTimestamp()
      });
    }

    if (!profileSnapshot.exists()) {
      if (!statsSnapshot.exists() || statsSnapshot.data().count >= 500) {
        throw new Error("AnonChat has reached its 500-user limit.");
      }
      transaction.update(statsRef, {
        count: statsSnapshot.data().count + 1,
        limit: 500,
        updatedAt: serverTimestamp()
      });
    }

    transaction.set(profileRef, {
      uid: user.uid,
      username,
      createdAt: profileSnapshot.data()?.createdAt || serverTimestamp(),
      lastActiveAt: profileSnapshot.data()?.lastActiveAt || serverTimestamp()
    });
  });

  await ensureDefaultOwnerFollows(user.uid, db);

  if (user.displayName !== username) {
    await updateProfile(user, { displayName: username });
  }

  return username;
};
