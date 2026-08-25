import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault(), projectId: process.env.GCLOUD_PROJECT || "anonchatlogin" });
const auth = getAuth();
const db = getFirestore();

const authUsers = [];
let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  authUsers.push(...page.users.map((user) => ({ uid: user.uid, displayName: user.displayName || null })));
  pageToken = page.pageToken;
} while (pageToken);

const [profiles, posts, follows] = await Promise.all([
  db.collection("users").get(),
  db.collection("posts").get(),
  db.collection("follows").get()
]);

console.log(JSON.stringify({
  authUsers,
  profiles: profiles.docs.map((entry) => ({ id: entry.id, fields: Object.keys(entry.data()), uid: entry.data().uid, username: entry.data().username })),
  posts: posts.docs.map((entry) => {
    const data = entry.data();
    return { id: entry.id, fields: Object.keys(data), authorId: data.authorId || null, uid: data.uid || null, userId: data.userId || null, username: data.username || null, type: data.type || null };
  }),
  follows: follows.docs.map((entry) => ({ id: entry.id, ...entry.data() }))
}, null, 2));
