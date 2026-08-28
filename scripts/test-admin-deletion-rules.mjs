import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-admin-deletion-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const queueFields = (requesterUid = "admin", timestamp = serverTimestamp(), status = "queued") => ({
  banned: true,
  adminDeletionRequestedAt: timestamp,
  adminDeletionRequestedBy: requesterUid,
  adminDeletionStatus: status
});
const jobFields = (targetUid = "target", requesterUid = "admin", timestamp = serverTimestamp(), status = "queued") => ({
  targetUid,
  requesterUid,
  requestedAt: timestamp,
  status
});
const profile = (uid, username = uid) => ({ uid, username, createdAt: new Date(0), lastActiveAt: new Date(0), banned: false });

const seed = async () => testEnv.withSecurityRulesDisabled(async (context) => {
  const firestore = context.firestore();
  await Promise.all([
    setDoc(doc(firestore, "users", "admin"), profile("admin", "i_love_you_h")),
    setDoc(doc(firestore, "users", "member"), profile("member", "member")),
    setDoc(doc(firestore, "users", "target"), profile("target", "target")),
    setDoc(doc(firestore, "users", "protected-one"), profile("protected-one", "  I_LOVE_YOU_H  ")),
    setDoc(doc(firestore, "users", "protected-two"), profile("protected-two", "ownerCyberCapone"))
  ]);
});
const queue = (firestore, options = {}) => {
  const targetUid = options.targetUid ?? "target";
  const requesterUid = options.requesterUid ?? "admin";
  const batch = writeBatch(firestore);
  batch.update(doc(firestore, "users", targetUid), options.profile ?? queueFields(requesterUid, options.timestamp, options.status));
  batch.set(doc(firestore, "adminDeletionJobs", options.jobId ?? targetUid), options.job ?? jobFields(targetUid, requesterUid, options.jobTimestamp ?? options.timestamp, options.jobStatus ?? options.status));
  return batch.commit();
};

try {
  await seed();
  const admin = testEnv.authenticatedContext("admin").firestore();
  const member = testEnv.authenticatedContext("member").firestore();
  const target = testEnv.authenticatedContext("target").firestore();

  await assertSucceeds(queue(admin));

  await testEnv.clearFirestore(); await seed();
  await assertFails(queue(member));
  await assertFails(queue(admin, { targetUid: "protected-one" }));
  await assertFails(queue(admin, { targetUid: "protected-two" }));
  await assertFails(queue(admin, { job: jobFields("wrong-target") }));
  await assertFails(queue(admin, { requesterUid: "member" }));
  await assertFails(queue(admin, { status: "started" }));
  await assertFails(queue(admin, { jobStatus: "started" }));
  await assertFails(queue(admin, { timestamp: new Date(0) }));
  await assertFails(queue(admin, { jobTimestamp: new Date(0) }));

  await assertFails(setDoc(doc(admin, "adminDeletionJobs", "target"), jobFields()));
  await assertFails(setDoc(doc(target, "adminDeletionJobs", "target"), jobFields("target", "target")));
  await assertFails(updateDoc(doc(admin, "users", "target"), queueFields()));

  await testEnv.clearFirestore(); await seed();
  await testEnv.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "adminDeletionJobs", "target"), jobFields()));
  await assertFails(queue(admin));

  await testEnv.clearFirestore(); await seed();
  await assertFails(queue(admin, { profile: { ...queueFields(), unexpected: true } }));

  await testEnv.clearFirestore(); await seed();
  await testEnv.withSecurityRulesDisabled(async (context) => updateDoc(
    doc(context.firestore(), "users", "target"),
    { adminDeletionStatus: "queued" }
  ));
  await assertFails(queue(admin));

  await testEnv.clearFirestore(); await seed();
  await assertSucceeds(updateDoc(doc(admin, "users", "target"), { banned: true }));
  await assertSucceeds(updateDoc(doc(admin, "users", "target"), { banned: false }));
  await assertFails(updateDoc(doc(member, "users", "target"), { banned: true }));
  await assertFails(updateDoc(doc(admin, "users", "target"), { banned: "true" }));
  await assertFails(updateDoc(doc(admin, "users", "target"), { banned: true, profileImage: "x" }));
  await assertFails(updateDoc(doc(admin, "users", "target"), queueFields()));

  await testEnv.clearFirestore(); await seed();
  await assertSucceeds(queue(admin));
  await assertFails(updateDoc(doc(admin, "adminDeletionJobs", "target"), { status: "started" }));
  await assertFails(deleteDoc(doc(admin, "adminDeletionJobs", "target")));
  await assertFails(updateDoc(doc(target, "adminDeletionJobs", "target"), { status: "started" }));
  await assertFails(deleteDoc(doc(target, "adminDeletionJobs", "target")));

  console.log("Firestore administrator deletion queue authorization passed");
} finally {
  await testEnv.cleanup();
}
