import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const credential = process.env.FIREBASE_ACCESS_TOKEN
  ? {
      getAccessToken: async () => ({
        access_token: process.env.FIREBASE_ACCESS_TOKEN,
        expires_in: 3600
      })
    }
  : applicationDefault();

initializeApp({ credential, projectId: process.env.GCLOUD_PROJECT || "anonchatlogin" });
const db = getFirestore();
const profiles = await db.collection("users").get();
const adminNames = new Set(["i_love_you_h", "ownercybercapone"]);
const matchedAdmins = profiles.docs.filter((entry) =>
  adminNames.has(String(entry.data().username || "").toLowerCase())
);

const setupBatch = db.batch();
matchedAdmins.forEach((entry) => {
  setupBatch.set(db.doc(`admins/${entry.id}`), {
    uid: entry.id,
    username: entry.data().username,
    createdAt: FieldValue.serverTimestamp()
  });
});
setupBatch.set(db.doc("system/accountStats"), {
  count: profiles.size,
  limit: 500,
  updatedAt: FieldValue.serverTimestamp()
});
await setupBatch.commit();

const reactions = await db.collectionGroup("reactions").get();
const grouped = new Map();
reactions.docs.forEach((entry) => {
  const postId = entry.ref.parent.parent.id;
  const data = entry.data();
  const key = `${postId}:${data.uid}`;
  const existing = grouped.get(key);
  const time = data.createdAt?.toMillis?.() || 0;
  if (!existing || time > existing.time) grouped.set(key, { entry, data, postId, time });
});

let deleted = 0;
let normalized = 0;
for (const group of grouped.values()) {
  const sameUser = reactions.docs.filter((entry) =>
    entry.ref.parent.parent.id === group.postId && entry.data().uid === group.data.uid
  );
  const batch = db.batch();
  sameUser.forEach((entry) => {
    batch.delete(entry.ref);
    deleted += 1;
  });
  batch.set(db.doc(`posts/${group.postId}/reactions/${group.data.uid}`), {
    uid: group.data.uid,
    type: ["heart", "middle_finger", "laugh"].includes(group.data.type) ? group.data.type : "heart",
    createdAt: group.data.createdAt || FieldValue.serverTimestamp()
  });
  await batch.commit();
  normalized += 1;
}

console.log(JSON.stringify({
  profiles: profiles.size,
  cap: 500,
  admins: matchedAdmins.map((entry) => entry.data().username),
  missingAdmins: [...adminNames].filter((name) =>
    !matchedAdmins.some((entry) => entry.data().username.toLowerCase() === name)
  ),
  oldReactionDocumentsDeleted: deleted,
  normalizedReactions: normalized
}));
