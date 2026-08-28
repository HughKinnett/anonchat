import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-activity-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const profile = (uid, banned = false) => ({
  uid,
  username: uid.replace("-", "_"),
  createdAt: new Date(0),
  lastActiveAt: new Date(0),
  banned
});

const seed = async () => testEnv.withSecurityRulesDisabled(async (context) => {
  const firestore = context.firestore();
  await Promise.all([
    setDoc(doc(firestore, "users", "user-a"), profile("user-a")),
    setDoc(doc(firestore, "users", "user-b"), profile("user-b")),
    setDoc(doc(firestore, "users", "banned-user"), profile("banned-user", true)),
    setDoc(doc(firestore, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) })
  ]);
});

try {
  await seed();
  const userA = testEnv.authenticatedContext("user-a").firestore();
  const userB = testEnv.authenticatedContext("user-b").firestore();
  const bannedUser = testEnv.authenticatedContext("banned-user").firestore();

  await assertSucceeds(updateDoc(doc(userA, "users", "user-a"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userB, "users", "user-a"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(bannedUser, "users", "banned-user"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userA, "users", "user-a"), { lastActiveAt: new Date() }));

  const newUser = testEnv.authenticatedContext("new-user").firestore();
  const createProfile = async (data) => {
    const batch = writeBatch(newUser);
    batch.set(doc(newUser, "users", "new-user"), data);
    batch.update(doc(newUser, "system", "accountStats"), { count: 6, limit: 500, updatedAt: serverTimestamp() });
    return batch.commit();
  };
  await assertSucceeds(createProfile({
    uid: "new-user",
    username: "new_user",
    createdAt: serverTimestamp(),
    lastActiveAt: serverTimestamp()
  }));

  await testEnv.clearFirestore();
  await seed();
  await assertFails(createProfile({
    uid: "new-user",
    username: "new_user",
    createdAt: serverTimestamp()
  }));

  await testEnv.clearFirestore();
  await seed();
  await assertFails(createProfile({
    uid: "new-user",
    username: "new_user",
    createdAt: new Date(),
    lastActiveAt: new Date()
  }));

  console.log("Firestore activity authorization passed");
} finally {
  await testEnv.cleanup();
}
