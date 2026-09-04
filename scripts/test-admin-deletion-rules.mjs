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
    setDoc(doc(firestore, "users", "admin-two"), profile("admin-two", "CyberCapone")),
    setDoc(doc(firestore, "usernames", "cybercapone"), { uid: "admin-two", username: "CyberCapone", createdAt: new Date(0) }),
    setDoc(doc(firestore, "users", "former-handle"), profile("former-handle", "OwnerCyberCapone")),
    setDoc(doc(firestore, "usernames", "ownercybercapone"), { uid: "former-handle", username: "OwnerCyberCapone", createdAt: new Date(0) }),
    setDoc(doc(firestore, "users", "member"), profile("member", "member")),
    setDoc(doc(firestore, "users", "target"), profile("target", "target")),
    setDoc(doc(firestore, "users", "protected-one"), profile("protected-one", "  I_LOVE_YOU_H  ")),
    setDoc(doc(firestore, "users", "protected-two"), profile("protected-two", "CyberCapone")),
    setDoc(doc(firestore, "users", "protected-nbsp"), profile("protected-nbsp", "\u00a0i_love_you_h\u00a0")),
    setDoc(doc(firestore, "users", "protected-bom"), profile("protected-bom", "\uFEFFcybercapone\uFEFF"))
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
const selfQueue = (firestore, uid = "member", username = "member", overrides = {}) => {
  const timestamp = serverTimestamp();
  const batch = writeBatch(firestore);
  batch.set(doc(firestore, "accountDeletionRequests", uid), overrides.request ?? { uid, username, createdAt: timestamp });
  batch.set(doc(firestore, "adminDeletionJobs", uid), overrides.job ?? { targetUid: uid, requesterUid: uid, requestedAt: timestamp, requestType: "self", status: "queued" });
  return batch.commit();
};

try {
  await seed();
  const admin = testEnv.authenticatedContext("admin", { email_verified: true }).firestore();
  const adminTwo = testEnv.authenticatedContext("admin-two", { email_verified: true }).firestore();
  const formerHandle = testEnv.authenticatedContext("former-handle", { email_verified: true }).firestore();
  const member = testEnv.authenticatedContext("member", { email_verified: true }).firestore();
  const target = testEnv.authenticatedContext("target", { email_verified: true }).firestore();

  await assertSucceeds(selfQueue(member));
  await assertSucceeds(getDoc(doc(member, "accountDeletionRequests", "member")));
  await assertSucceeds(getDoc(doc(member, "adminDeletionJobs", "member")));
  await assertFails(setDoc(doc(member, "posts", "after-self-lock"), {
    type: "original", authorId: "member", username: "member", content: "blocked", imageData: "", category: "Post", options: [], expiresAt: null, moderationState: "visible", createdAt: serverTimestamp()
  }));
  await assertFails(deleteDoc(doc(member, "adminDeletionJobs", "member")));

  await testEnv.clearFirestore(); await seed();
  const memberAgain = testEnv.authenticatedContext("member", { email_verified: true }).firestore();
  await assertFails(selfQueue(memberAgain, "target", "target"));
  await assertFails(selfQueue(memberAgain, "member", "member", { job: { targetUid: "member", requesterUid: "member", requestedAt: serverTimestamp(), requestType: "admin", status: "queued" } }));
  await assertFails(selfQueue(testEnv.authenticatedContext("protected-one", { email_verified: true }).firestore(), "protected-one", "  I_LOVE_YOU_H  "));

  await testEnv.clearFirestore(); await seed();
  const legacyCreatedAt = new Date(1234);
  await testEnv.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), "accountDeletionRequests", "member"), {
    uid: "member", username: "member", createdAt: legacyCreatedAt
  }));
  const legacyMember = testEnv.authenticatedContext("member", { email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(legacyMember, "adminDeletionJobs", "member"), {
    targetUid: "member", requesterUid: "member", requestedAt: legacyCreatedAt, requestType: "self", status: "queued"
  }));
  await assertFails(deleteDoc(doc(legacyMember, "accountDeletionRequests", "member")), "a queued job keeps its validated request anchor immutable");

  await assertSucceeds(updateDoc(doc(adminTwo, "users", "target"), { banned: true }));
  await assertSucceeds(updateDoc(doc(adminTwo, "users", "target"), { banned: false }));
  await assertFails(updateDoc(doc(formerHandle, "users", "target"), { banned: true }));
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
  await assertFails(updateDoc(doc(admin, "users", "protected-one"), { banned: true }));
  await assertFails(updateDoc(doc(admin, "users", "protected-two"), { banned: true }));

  await testEnv.withSecurityRulesDisabled(async (context) => Promise.all([
    updateDoc(doc(context.firestore(), "users", "protected-one"), { banned: true }),
    updateDoc(doc(context.firestore(), "users", "protected-two"), { banned: true })
  ]));
  await assertFails(updateDoc(doc(admin, "users", "protected-one"), { banned: false }));
  await assertFails(updateDoc(doc(admin, "users", "protected-two"), { banned: false }));

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
  const forgedAdmin = testEnv.authenticatedContext("forged-admin", { email_verified: true }).firestore();
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
  const mismatchedAdmin = testEnv.authenticatedContext("mismatched-admin", { email_verified: true }).firestore();
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
      setDoc(doc(firestore, "users", "mismatched-health-admin"), profile("mismatched-health-admin", "CyberCapone")),
      setDoc(doc(firestore, "usernames", "cybercapone"), { uid: "another-user", username: "CyberCapone", createdAt: new Date(0) })
    ]);
  });
  const unauthenticated = testEnv.unauthenticatedContext().firestore();
  const forgedHealthAdmin = testEnv.authenticatedContext("forged-health-admin", { email_verified: true }).firestore();
  const mismatchedHealthAdmin = testEnv.authenticatedContext("mismatched-health-admin", { email_verified: true }).firestore();
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
      setDoc(doc(firestore, "users", "banned-health-admin"), { ...profile("banned-health-admin", "CyberCapone"), banned: true }),
      setDoc(doc(firestore, "usernames", "cybercapone"), { uid: "banned-health-admin", username: "CyberCapone", createdAt: new Date(0) })
    ]);
  });
  const bannedHealthAdmin = testEnv.authenticatedContext("banned-health-admin", { email_verified: true }).firestore();
  await assertFails(getDoc(doc(bannedHealthAdmin, "system", "deletionProcessor")));

  console.log("Firestore administrator deletion queue authorization passed");
} finally {
  await testEnv.cleanup();
}
