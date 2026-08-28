import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-activity-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const DAY_MS = 24 * 60 * 60 * 1000;
const moreThanTwentyFourHoursAgo = new Date(Date.now() - DAY_MS - 60_000);
const profile = (uid, options = {}) => {
  const data = {
    uid,
    username: uid.replace("-", "_"),
    createdAt: new Date(0),
    banned: options.banned ?? false
  };
  if (!Object.hasOwn(options, "lastActiveAt")) data.lastActiveAt = new Date(0);
  if (options.lastActiveAt !== undefined) data.lastActiveAt = options.lastActiveAt;
  return data;
};
const missingActivityProfile = profile("missing-activity", { lastActiveAt: undefined });
assert.equal(
  Object.hasOwn(missingActivityProfile, "lastActiveAt"),
  false,
  "the missing-activity fixture omits lastActiveAt instead of assigning a default"
);

const seed = async () => testEnv.withSecurityRulesDisabled(async (context) => {
  const firestore = context.firestore();
  await Promise.all([
    setDoc(doc(firestore, "users", "user-a"), profile("user-a")),
    setDoc(doc(firestore, "users", "user-b"), profile("user-b")),
    setDoc(doc(firestore, "users", "banned-user"), profile("banned-user", { banned: true })),
    setDoc(doc(firestore, "users", "missing-activity"), missingActivityProfile),
    setDoc(doc(firestore, "users", "after-threshold-user"), profile("after-threshold-user", { lastActiveAt: moreThanTwentyFourHoursAgo })),
    setDoc(doc(firestore, "users", "future-activity"), profile("future-activity", { lastActiveAt: new Date(Date.now() + DAY_MS) })),
    setDoc(doc(firestore, "users", "admin-user"), { ...profile("admin-user"), username: "i_love_you_h" }),
    setDoc(doc(firestore, "users", "banned-admin"), { ...profile("banned-admin", { banned: true }), username: "ownercybercapone" }),
    setDoc(doc(firestore, "users", "ordinary-client-date"), profile("ordinary-client-date")),
    setDoc(doc(firestore, "users", "admin-client-date"), { ...profile("admin-client-date"), username: "i_love_you_h" }),
    setDoc(doc(firestore, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) })
  ]);
});

try {
  await seed();
  const userA = testEnv.authenticatedContext("user-a").firestore();
  const userB = testEnv.authenticatedContext("user-b").firestore();
  const bannedUser = testEnv.authenticatedContext("banned-user").firestore();
  const missingActivity = testEnv.authenticatedContext("missing-activity").firestore();
  const afterThresholdUser = testEnv.authenticatedContext("after-threshold-user").firestore();
  const futureActivity = testEnv.authenticatedContext("future-activity").firestore();
  const adminUser = testEnv.authenticatedContext("admin-user").firestore();
  const bannedAdmin = testEnv.authenticatedContext("banned-admin").firestore();
  const ordinaryClientDate = testEnv.authenticatedContext("ordinary-client-date").firestore();
  const adminClientDate = testEnv.authenticatedContext("admin-client-date").firestore();

  await assertSucceeds(updateDoc(doc(userA, "users", "user-a"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userA, "users", "user-a"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userB, "users", "user-a"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(bannedUser, "users", "banned-user"), { lastActiveAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(missingActivity, "users", "missing-activity"), { lastActiveAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(afterThresholdUser, "users", "after-threshold-user"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(futureActivity, "users", "future-activity"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(ordinaryClientDate, "users", "ordinary-client-date"), { lastActiveAt: new Date() }));

  await assertSucceeds(updateDoc(doc(adminUser, "users", "admin-user"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(adminUser, "users", "user-b"), { lastActiveAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(adminClientDate, "users", "admin-client-date"), { lastActiveAt: new Date() }));
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
