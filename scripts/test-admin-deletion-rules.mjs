import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";

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
    setDoc(doc(firestore, "usernames", "i_love_you_h"), { uid: "admin", username: "i_love_you_h", createdAt: new Date(0) }),
    setDoc(doc(firestore, "users", "member"), profile("member", "member")),
    setDoc(doc(firestore, "users", "target"), profile("target", "target")),
    setDoc(doc(firestore, "users", "protected-one"), profile("protected-one", "  I_LOVE_YOU_H  ")),
    setDoc(doc(firestore, "users", "protected-two"), profile("protected-two", "ownerCyberCapone")),
    setDoc(doc(firestore, "users", "protected-nbsp"), profile("protected-nbsp", "\u00a0i_love_you_h\u00a0")),
    setDoc(doc(firestore, "users", "protected-bom"), profile("protected-bom", "\uFEFFownercybercapone\uFEFF"))
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
  await assertFails(queue(admin, { targetUid: "protected-nbsp" }));
  await assertFails(queue(admin, { targetUid: "protected-bom" }));
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
  await assertSucceeds(updateDoc(doc(admin, "users", "target"), { banned: true }));
  await assertFails(updateDoc(doc(admin, "users", "target"), { banned: false }));
  await assertFails(updateDoc(doc(admin, "users", "target"), { banned: true, profileImage: "x" }));
  await assertFails(deleteDoc(doc(admin, "users", "target")));
  await assertFails(updateDoc(doc(admin, "adminDeletionJobs", "target"), { status: "started" }));
  await assertFails(deleteDoc(doc(admin, "adminDeletionJobs", "target")));
  await assertFails(updateDoc(doc(target, "adminDeletionJobs", "target"), { status: "started" }));
  await assertFails(deleteDoc(doc(target, "adminDeletionJobs", "target")));

  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, "users", "forged-admin"), profile("forged-admin", "i_love_you_h")),
      setDoc(doc(firestore, "users", "target"), profile("target", "target"))
    ]);
  });
  const forgedAdmin = testEnv.authenticatedContext("forged-admin").firestore();
  await assertFails(updateDoc(doc(forgedAdmin, "users", "target"), { banned: true }));

  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, "users", "mismatched-admin"), profile("mismatched-admin", "i_love_you_h")),
      setDoc(doc(firestore, "usernames", "i_love_you_h"), { uid: "someone-else", username: "i_love_you_h", createdAt: new Date(0) }),
      setDoc(doc(firestore, "users", "target"), profile("target", "target"))
    ]);
  });
  const mismatchedAdmin = testEnv.authenticatedContext("mismatched-admin").firestore();
  await assertFails(updateDoc(doc(mismatchedAdmin, "users", "target"), { banned: true }));

  await testEnv.clearFirestore(); await seed();
  await testEnv.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), "users", "admin"), { banned: true }));
  await assertFails(updateDoc(doc(admin, "users", "target"), { banned: true }));

  await testEnv.clearFirestore(); await seed();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, "system", "deletionProcessor"), { updatedAt: new Date(0), status: "working" }),
      setDoc(doc(firestore, "users", "forged-health-admin"), profile("forged-health-admin", "i_love_you_h")),
      setDoc(doc(firestore, "users", "mismatched-health-admin"), profile("mismatched-health-admin", "ownerCyberCapone")),
      setDoc(doc(firestore, "usernames", "ownercybercapone"), { uid: "another-user", username: "ownerCyberCapone", createdAt: new Date(0) })
    ]);
  });
  const unauthenticated = testEnv.unauthenticatedContext().firestore();
  const forgedHealthAdmin = testEnv.authenticatedContext("forged-health-admin").firestore();
  const mismatchedHealthAdmin = testEnv.authenticatedContext("mismatched-health-admin").firestore();
  await assertSucceeds(getDoc(doc(admin, "system", "deletionProcessor")));
  await assertFails(getDoc(doc(member, "system", "deletionProcessor")));
  await assertFails(getDoc(doc(forgedHealthAdmin, "system", "deletionProcessor")));
  await assertFails(getDoc(doc(mismatchedHealthAdmin, "system", "deletionProcessor")));
  await assertFails(getDoc(doc(unauthenticated, "system", "deletionProcessor")));
  await assertFails(setDoc(doc(admin, "system", "deletionProcessor"), { updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(admin, "system", "deletionProcessor"), { status: "failed" }));
  await assertFails(deleteDoc(doc(admin, "system", "deletionProcessor")));

  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    await Promise.all([
      setDoc(doc(firestore, "system", "deletionProcessor"), { updatedAt: new Date(0), status: "working" }),
      setDoc(doc(firestore, "users", "banned-health-admin"), { ...profile("banned-health-admin", "ownercybercapone"), banned: true }),
      setDoc(doc(firestore, "usernames", "ownercybercapone"), { uid: "banned-health-admin", username: "ownercybercapone", createdAt: new Date(0) })
    ]);
  });
  const bannedHealthAdmin = testEnv.authenticatedContext("banned-health-admin").firestore();
  await assertFails(getDoc(doc(bannedHealthAdmin, "system", "deletionProcessor")));

  console.log("Firestore administrator deletion queue authorization passed");
} finally {
  await testEnv.cleanup();
}
