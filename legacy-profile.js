import { updateProfile } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const ensureUserProfile = async (user, db) => {
  const preferred = /^[A-Za-z0-9_]{3,30}$/.test(user.displayName || "")
    ? user.displayName
    : `anon_${user.uid.slice(0, 8)}`;
  const preferredKey = preferred.toLowerCase();
  const fallback = `u_${user.uid}`;
  const fallbackKey = fallback.toLowerCase();
  let username = preferred;

  await runTransaction(db, async (transaction) => {
    const profileRef = doc(db, "users", user.uid);
    const preferredRef = doc(db, "usernames", preferredKey);
    const fallbackRef = doc(db, "usernames", fallbackKey);
    const preferredSnapshot = await transaction.get(preferredRef);
    const fallbackSnapshot = preferredKey === fallbackKey
      ? preferredSnapshot
      : await transaction.get(fallbackRef);

    const preferredAvailable =
      !preferredSnapshot.exists() || preferredSnapshot.data().uid === user.uid;

    if (!preferredAvailable) {
      if (fallbackSnapshot.exists() && fallbackSnapshot.data().uid !== user.uid) {
        throw new Error("Could not reserve a unique legacy username.");
      }
      username = fallback;
    }

    const usernameRef = username === preferred ? preferredRef : fallbackRef;
    const usernameSnapshot = username === preferred ? preferredSnapshot : fallbackSnapshot;

    if (!usernameSnapshot.exists()) {
      transaction.set(usernameRef, {
        uid: user.uid,
        username,
        createdAt: serverTimestamp()
      });
    }

    transaction.set(profileRef, {
      uid: user.uid,
      username,
      createdAt: serverTimestamp()
    });
  });

  if (user.displayName !== username) {
    await updateProfile(user, { displayName: username });
  }

  return username;
};
