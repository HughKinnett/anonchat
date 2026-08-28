import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT || "anonchatlogin"
});

const auth = getAuth();
const db = getFirestore();
const validUsername = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_]{3,30}$/.test(value);

let scanned = 0;
let created = 0;
let repaired = 0;
let unchanged = 0;
let renamed = 0;

const migrateUser = async (user) => {
  const result = await db.runTransaction(async (transaction) => {
    const profileRef = db.doc(`users/${user.uid}`);
    const profileSnapshot = await transaction.get(profileRef);
    const profile = profileSnapshot.exists ? profileSnapshot.data() : {};
    const preferred = validUsername(profile.username)
      ? profile.username
      : validUsername(user.displayName)
        ? user.displayName
        : `anon_${user.uid.slice(0, 8)}`;
    const fallback = `u_${user.uid}`;
    const preferredRef = db.doc(`usernames/${preferred.toLowerCase()}`);
    const fallbackRef = db.doc(`usernames/${fallback.toLowerCase()}`);
    const preferredSnapshot = await transaction.get(preferredRef);
    const fallbackSnapshot = preferred.toLowerCase() === fallback.toLowerCase()
      ? preferredSnapshot
      : await transaction.get(fallbackRef);
    const preferredAvailable =
      !preferredSnapshot.exists || preferredSnapshot.data().uid === user.uid;
    const username = preferredAvailable ? preferred : fallback;
    const usernameRef = preferredAvailable ? preferredRef : fallbackRef;
    const usernameSnapshot = preferredAvailable ? preferredSnapshot : fallbackSnapshot;

    if (usernameSnapshot.exists && usernameSnapshot.data().uid !== user.uid) {
      throw new Error(`No unique username available for ${user.uid}`);
    }

    if (!usernameSnapshot.exists) {
      transaction.set(usernameRef, {
        uid: user.uid,
        username,
        createdAt: FieldValue.serverTimestamp()
      });
    }

    const complete = profileSnapshot.exists
      && profile.uid === user.uid
      && profile.username === username
      && validUsername(profile.username);

    if (!complete) {
      transaction.set(profileRef, {
        uid: user.uid,
        username,
        createdAt: profile.createdAt || FieldValue.serverTimestamp(),
        lastActiveAt: profile.lastActiveAt || FieldValue.serverTimestamp()
      });
    }

    return {
      username,
      existed: profileSnapshot.exists,
      complete
    };
  });

  if (user.displayName !== result.username) {
    await auth.updateUser(user.uid, { displayName: result.username });
    renamed += 1;
  }

  if (result.complete) unchanged += 1;
  else if (result.existed) repaired += 1;
  else created += 1;
};

let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    scanned += 1;
    await migrateUser(user);
  }
  pageToken = page.pageToken;
} while (pageToken);

console.log(JSON.stringify({ scanned, created, repaired, unchanged, renamed }));
