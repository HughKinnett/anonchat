import fs from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "firebase/firestore";

const projectId = "anonchat-phase-b-rules";
const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });

const verified = { email: "user@example.com", email_verified: true };
const ownerDb = env.authenticatedContext("owner", verified).firestore();
const otherDb = env.authenticatedContext("other", { email: "other@example.com", email_verified: true }).firestore();
const adminDb = env.authenticatedContext("admin", { email: "admin@example.com", email_verified: true }).firestore();

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, "users", "owner"), { uid: "owner", username: "owner_user", createdAt: new Date(), lastActiveAt: new Date() });
  await setDoc(doc(db, "users", "other"), { uid: "other", username: "other_user", createdAt: new Date(), lastActiveAt: new Date() });
  await setDoc(doc(db, "users", "admin"), { uid: "admin", username: "i_love_you_h", createdAt: new Date(), lastActiveAt: new Date() });
  await setDoc(doc(db, "usernames", "i_love_you_h"), { uid: "admin", username: "i_love_you_h" });
  await setDoc(doc(db, "posts", "p1"), {
    type: "original",
    authorId: "owner",
    username: "owner_user",
    content: "before #old",
    imageData: "",
    media: [],
    category: "Post",
    options: [],
    expiresAt: null,
    moderationState: "visible",
    createdAt: new Date(),
    topics: ["post", "old"]
  });
  await setDoc(doc(db, "posts", "p1", "comments", "c1"), {
    uid: "owner",
    username: "owner_user",
    text: "before comment",
    createdAt: new Date()
  });
  await setDoc(doc(db, "posts", "p1", "editHistory", "seed"), {
    content: "seed",
    editVersion: 0,
    editorUid: "owner",
    archivedAt: new Date()
  });
});

const savedOwner = doc(ownerDb, "users", "owner", "saved", "posts%2Fp1");
await assertSucceeds(setDoc(savedOwner, {
  uid: "owner",
  postPath: "posts/p1",
  savedAt: serverTimestamp()
}));
await assertSucceeds(getDoc(savedOwner));
await assertFails(getDoc(doc(otherDb, "users", "owner", "saved", "posts%2Fp1")));
await assertFails(setDoc(doc(otherDb, "users", "owner", "saved", "evil"), {
  uid: "owner", postPath: "posts/p1", savedAt: serverTimestamp()
}));

const historyOwner = doc(ownerDb, "users", "owner", "viewHistory", "posts%2Fp1");
await assertSucceeds(setDoc(historyOwner, {
  uid: "owner",
  postPath: "posts/p1",
  viewedAt: serverTimestamp()
}));
await assertSucceeds(getDoc(historyOwner));
await assertFails(getDoc(doc(otherDb, "users", "owner", "viewHistory", "posts%2Fp1")));

const searchOwner = doc(ownerDb, "users", "owner", "recentSearches", "music");
await assertSucceeds(setDoc(searchOwner, {
  uid: "owner",
  value: "music",
  searchedAt: serverTimestamp()
}));
await assertSucceeds(getDoc(searchOwner));
await assertFails(getDoc(doc(otherDb, "users", "owner", "recentSearches", "music")));

const postBatch = writeBatch(ownerDb);
postBatch.set(doc(ownerDb, "posts", "p1", "editHistory", "v1"), {
  content: "before #old",
  editVersion: 0,
  editorUid: "owner",
  archivedAt: serverTimestamp()
});
postBatch.update(doc(ownerDb, "posts", "p1"), {
  content: "after #new",
  topics: ["post", "new"],
  editedAt: serverTimestamp(),
  editVersion: 1
});
await assertSucceeds(postBatch.commit());
await assertFails(updateDoc(doc(otherDb, "posts", "p1"), {
  content: "hijacked",
  editedAt: serverTimestamp(),
  editVersion: 2
}));

const commentBatch = writeBatch(ownerDb);
commentBatch.set(doc(ownerDb, "posts", "p1", "comments", "c1", "editHistory", "v1"), {
  content: "before comment",
  editVersion: 0,
  editorUid: "owner",
  archivedAt: serverTimestamp()
});
commentBatch.update(doc(ownerDb, "posts", "p1", "comments", "c1"), {
  text: "after comment",
  editedAt: serverTimestamp(),
  editVersion: 1
});
await assertSucceeds(commentBatch.commit());

await assertFails(getDoc(doc(ownerDb, "posts", "p1", "editHistory", "seed")));
await assertFails(getDoc(doc(otherDb, "posts", "p1", "editHistory", "seed")));
await assertSucceeds(getDoc(doc(adminDb, "posts", "p1", "editHistory", "seed")));

await env.cleanup();
console.log("Phase B Firestore rules contract passed");
