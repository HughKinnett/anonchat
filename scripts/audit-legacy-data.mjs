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
  authUsers.push(...page.users);
  pageToken = page.pageToken;
} while (pageToken);

const [profiles, posts, follows] = await Promise.all([
  db.collection("users").get(),
  db.collection("posts").get(),
  db.collection("follows").get()
]);
const authIds = new Set(authUsers.map((user) => user.uid));
const profileIds = new Set(profiles.docs.map((entry) => entry.id));
const valid = (entry) => {
  const data = entry.data();
  return data.uid === entry.id && typeof data.username === "string" && /^[A-Za-z0-9_]{3,30}$/.test(data.username);
};
console.log(JSON.stringify({
  authAccounts: authUsers.length,
  profileDocuments: profiles.size,
  validProfiles: profiles.docs.filter(valid).length,
  authWithoutProfile: authUsers.filter((user) => !profileIds.has(user.uid)).map((user) => user.uid),
  profileWithoutAuth: profiles.docs.filter((entry) => !authIds.has(entry.id)).map((entry) => entry.id),
  posts: posts.size,
  postsMissingAuthorId: posts.docs.filter((entry) => !entry.data().authorId).map((entry) => ({ id: entry.id, fields: Object.keys(entry.data()), username: entry.data().username || null })),
  postsWithUnknownAuthor: posts.docs.filter((entry) => entry.data().authorId && !authIds.has(entry.data().authorId)).map((entry) => ({ id: entry.id, authorId: entry.data().authorId, username: entry.data().username || null })),
  follows: follows.size,
  followsWithMissingProfiles: follows.docs.filter((entry) => !profileIds.has(entry.data().followerId) || !profileIds.has(entry.data().followingId)).map((entry) => entry.id)
}));
