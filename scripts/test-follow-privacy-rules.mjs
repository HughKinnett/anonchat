import fs from "node:fs/promises";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where
} from "firebase/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const projectId = "anonchat-follow-privacy-rules";
const rules = await fs.readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });

await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  for (const uid of ["user-a", "user-b", "user-c"]) {
    await setDoc(doc(db, "users", uid), { uid, username: uid.replace("user-", "user"), banned: false });
  }
  await setDoc(doc(db, "follows", "user-a_user-b"), {
    followerId: "user-a", followingId: "user-b", createdAt: new Date()
  });
  await setDoc(doc(db, "follows", "user-c_user-b"), {
    followerId: "user-c", followingId: "user-b", createdAt: new Date()
  });
  await setDoc(doc(db, "follows", "user-b_user-a"), {
    followerId: "user-b", followingId: "user-a", createdAt: new Date()
  });
});

const userA = env.authenticatedContext("user-a", {
  email_verified: true,
  email: "user-a@example.com"
}).firestore();

await assertSucceeds(getDocs(query(collection(userA, "follows"), where("followerId", "==", "user-a"))));
await assertSucceeds(getDocs(query(collection(userA, "follows"), where("followingId", "==", "user-a"))));
await assertSucceeds(getDoc(doc(userA, "follows", "user-a_user-b")));
await assertFails(getDoc(doc(userA, "follows", "user-c_user-b")));
await assertFails(getDocs(query(collection(userA, "follows"), where("followingId", "==", "user-b"))));
await assertFails(getDocs(collection(userA, "follows")));

await env.cleanup();
console.log("Follower graph privacy rules passed");
