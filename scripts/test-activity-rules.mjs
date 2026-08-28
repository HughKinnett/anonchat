import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-activity-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const DAY_MS = 24 * 60 * 60 * 1000;
const exactlyTwentyFourHoursAgo = new Date(Date.now() - DAY_MS);
const moreThanTwentyFourHoursAgo = new Date(Date.now() - DAY_MS - 60_000);
const profile = (uid, { banned = false, lastActiveAt = new Date(0) } = {}) => ({
  uid,
  username: uid.replace("-", "_"),
  createdAt: new Date(0),
  lastActiveAt,
  banned
});

const seed = async () => testEnv.withSecurityRulesDisabled(async (context) => {
  const firestore = context.firestore();
  await Promise.all([
    setDoc(doc(firestore, "users", "user-a"), profile("user-a")),
    setDoc(doc(firestore, "users", "user-b"), profile("user-b")),
    setDoc(doc(firestore, "users", "banned-user"), profile("banned-user", { banned: true })),
    setDoc(doc(firestore, "users", "missing-activity"), profile("missing-activity", { lastActiveAt: undefined })),
    setDoc(doc(firestore, "users", "threshold-user"), profile("threshold-user", { lastActiveAt: exactlyTwentyFourHoursAgo })),
    setDoc(doc(firestore, "users", "after-threshold-user"), profile("after-threshold-user", { lastActiveAt: moreThanTwentyFourHoursAgo })),
    setDoc(doc(firestore, "users", "future-activity"), profile("future-activity", { lastActiveAt: new Date(Date.now() + DAY_MS) })),
    setDoc(doc(firestore, "users", "admin-user"), { ...profile("admin-user"), username: "i_love_you_h" }),
    setDoc(doc(firestore, "users", "banned-admin"), { ...profile("banned-admin", { banned: true }), username: "ownercybercapone" }),
    setDoc(doc(firestore, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) })
  ]);
});

try {
  await seed();
  const userA = testEnv.authenticatedContext("user-a").firestore();
  const userB = testEnv.authenticatedContext("user-b").firestore();
  const bannedUser = testEnv.authenticatedContext("banned-user").firestore();
  const missingActivity = testEnv.authenticatedContext("missing-activity").firestore();
  const thresholdUser = testEnv.authenticatedContext("threshold-user").firestore();
  const afterThresholdUser = testEnv.authenticatedContext("after-threshold-user").firestore();
  const futureActivity = testEnv.authenticatedContext("future-activity").firestore();
  const adminUser = testEnv.authenticatedContext("admin-user").firestore();
  const bannedAdmin = testEnv.authenticatedContext("banned-admin").firestore();

  await assertSucceeds(updateDoc(doc(userA, "users", "user-a"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userA, "users", "user-a"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userB, "users", "user-a"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(bannedUser, "users", "banned-user"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userA, "users", "user-a"), { lastActiveAt: new Date() }));
  await assertSucceeds(updateDoc(doc(missingActivity, "users", "missing-activity"), { lastActiveAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(thresholdUser, "users", "threshold-user"), { lastActiveAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(afterThresholdUser, "users", "after-threshold-user"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(futureActivity, "users", "future-activity"), { lastActiveAt: serverTimestamp() }));

  await assertSucceeds(updateDoc(doc(adminUser, "users", "admin-user"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(adminUser, "users", "user-b"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(adminUser, "users", "admin-user"), { lastActiveAt: new Date() }));
  await assertFails(updateDoc(doc(bannedAdmin, "users", "banned-admin"), { lastActiveAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(adminUser, "users", "user-b"), { banned: true }));

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
