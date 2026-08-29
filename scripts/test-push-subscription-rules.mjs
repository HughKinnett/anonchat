import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-push-subscription-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const IDS = {
  own: "a".repeat(64),
  other: "b".repeat(64),
  denied: "c".repeat(64),
  banned: "d".repeat(64),
  deleting: "e".repeat(64),
  selfDeleting: "f".repeat(64),
  selfDeleteFlow: "0".repeat(64),
  selfDeleteRace: "1".repeat(64)
};
const data = (uid, suffix = uid) => ({
  uid,
  endpoint: `https://push.example/subscriptions/${suffix}`,
  expirationTime: null,
  p256dh: "BNc9_fR0-valid-p256dh",
  auth: "valid_auth-key",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});
const seededData = (uid) => ({
  ...data(uid),
  createdAt: new Date(0),
  updatedAt: new Date(0)
});
const seed = async () => testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await Promise.all([
    setDoc(doc(db, "users", "user-a"), { uid: "user-a", username: "user_a", banned: false, createdAt: new Date(0) }),
    setDoc(doc(db, "users", "user-b"), { uid: "user-b", username: "user_b", banned: false, createdAt: new Date(0) }),
    setDoc(doc(db, "users", "banned-user"), { uid: "banned-user", username: "banned_user", banned: true, createdAt: new Date(0) }),
    setDoc(doc(db, "users", "deleting-user"), { uid: "deleting-user", username: "deleting_user", banned: false, createdAt: new Date(0) }),
    setDoc(doc(db, "users", "self-deleting-user"), { uid: "self-deleting-user", username: "self_deleting_user", banned: false, createdAt: new Date(0) }),
    setDoc(doc(db, "users", "self-delete-flow"), { uid: "self-delete-flow", username: "self_delete_flow", banned: false, createdAt: new Date(0) }),
    setDoc(doc(db, "users", "admin-user"), { uid: "admin-user", username: "i_love_you_h", banned: false, createdAt: new Date(0) }),
    setDoc(doc(db, "usernames", "i_love_you_h"), { uid: "admin-user", username: "i_love_you_h", createdAt: new Date(0) }),
    setDoc(doc(db, "adminDeletionJobs", "deleting-user"), { targetUid: "deleting-user", status: "queued" }),
    setDoc(doc(db, "accountDeletionRequests", "self-deleting-user"), { uid: "self-deleting-user", status: "pending" }),
    setDoc(doc(db, "pushSubscriptions", IDS.banned), seededData("banned-user")),
    setDoc(doc(db, "pushSubscriptions", IDS.deleting), seededData("deleting-user")),
    setDoc(doc(db, "pushSubscriptions", IDS.selfDeleting), seededData("self-deleting-user"))
  ]);
});

try {
  await seed();
  const userA = testEnv.authenticatedContext("user-a").firestore();
  const userB = testEnv.authenticatedContext("user-b").firestore();
  const banned = testEnv.authenticatedContext("banned-user").firestore();
  const deleting = testEnv.authenticatedContext("deleting-user").firestore();
  const selfDeleting = testEnv.authenticatedContext("self-deleting-user").firestore();
  const selfDeleteFlow = testEnv.authenticatedContext("self-delete-flow").firestore();
  const admin = testEnv.authenticatedContext("admin-user").firestore();
  const unauthenticated = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(setDoc(doc(userA, "pushSubscriptions", IDS.own), data("user-a", "own")));
  const ownSnapshot = await assertSucceeds(getDoc(doc(userA, "pushSubscriptions", IDS.own)));
  assert.equal(ownSnapshot.data().endpoint, "https://push.example/subscriptions/own");
  await assertSucceeds(getDocs(query(collection(userA, "pushSubscriptions"), where("uid", "==", "user-a"))));
  await assertFails(getDocs(collection(userA, "pushSubscriptions")));
  await assertFails(getDocs(query(collection(userA, "pushSubscriptions"), where("uid", "==", "user-b"))));

  await assertFails(getDoc(doc(userB, "pushSubscriptions", IDS.own)));
  await assertFails(getDoc(doc(admin, "pushSubscriptions", IDS.own)));
  await assertFails(getDoc(doc(unauthenticated, "pushSubscriptions", IDS.own)));
  await assertFails(setDoc(doc(userB, "pushSubscriptions", IDS.other), data("user-a", "forged-owner")));
  await assertFails(setDoc(doc(unauthenticated, "pushSubscriptions", IDS.other), data("user-a", "unauthenticated")));
  await assertFails(setDoc(doc(banned, "pushSubscriptions", IDS.denied), data("banned-user", "banned")));
  await assertFails(setDoc(doc(deleting, "pushSubscriptions", IDS.denied), data("deleting-user", "deleting")));
  await assertFails(setDoc(doc(selfDeleting, "pushSubscriptions", IDS.denied), data("self-deleting-user", "self-deleting")));
  await assertFails(setDoc(doc(testEnv.authenticatedContext("missing-profile").firestore(), "pushSubscriptions", IDS.denied), data("missing-profile")));
  await assertFails(getDoc(doc(banned, "pushSubscriptions", IDS.banned)));
  await assertFails(deleteDoc(doc(banned, "pushSubscriptions", IDS.banned)));
  await assertFails(getDoc(doc(deleting, "pushSubscriptions", IDS.deleting)));
  await assertFails(deleteDoc(doc(deleting, "pushSubscriptions", IDS.deleting)));
  await assertSucceeds(getDoc(doc(selfDeleting, "pushSubscriptions", IDS.selfDeleting)));
  await assertSucceeds(getDocs(query(
    collection(selfDeleting, "pushSubscriptions"),
    where("uid", "==", "self-deleting-user")
  )));
  await assertFails(getDocs(collection(selfDeleting, "pushSubscriptions")));
  await assertFails(getDoc(doc(userB, "pushSubscriptions", IDS.selfDeleting)));
  await assertFails(deleteDoc(doc(userB, "pushSubscriptions", IDS.selfDeleting)));
  await assertFails(updateDoc(doc(selfDeleting, "pushSubscriptions", IDS.selfDeleting), {
    auth: "replacement_auth",
    updatedAt: serverTimestamp()
  }));
  await assertSucceeds(deleteDoc(doc(selfDeleting, "pushSubscriptions", IDS.selfDeleting)));

  await assertSucceeds(setDoc(doc(selfDeleteFlow, "pushSubscriptions", IDS.selfDeleteFlow), data("self-delete-flow")));
  const deletionTime = serverTimestamp(), deletionBatch = writeBatch(selfDeleteFlow);
  deletionBatch.set(doc(selfDeleteFlow, "accountDeletionRequests", "self-delete-flow"), {
    uid: "self-delete-flow", username: "self_delete_flow", createdAt: deletionTime
  });
  deletionBatch.set(doc(selfDeleteFlow, "adminDeletionJobs", "self-delete-flow"), {
    targetUid: "self-delete-flow", requesterUid: "self-delete-flow", requestedAt: deletionTime, requestType: "self", status: "queued"
  });
  await assertSucceeds(deletionBatch.commit());
  const sameUserOtherDevice = testEnv.authenticatedContext("self-delete-flow").firestore();
  await assertFails(setDoc(doc(sameUserOtherDevice, "pushSubscriptions", IDS.selfDeleteRace), data("self-delete-flow", "race-create")));
  await assertFails(updateDoc(doc(sameUserOtherDevice, "pushSubscriptions", IDS.selfDeleteFlow), {
    auth: "race_update_auth",
    updatedAt: serverTimestamp()
  }));
  const selfDeleteSubscriptions = await assertSucceeds(getDocs(query(
    collection(selfDeleteFlow, "pushSubscriptions"),
    where("uid", "==", "self-delete-flow")
  )));
  assert.equal(selfDeleteSubscriptions.size, 1, "barrier-first cleanup can still discover every existing owner subscription");
  await assertFails(getDoc(doc(userB, "pushSubscriptions", IDS.selfDeleteFlow)));
  await assertSucceeds(deleteDoc(selfDeleteSubscriptions.docs[0].ref));
  const retrySubscriptions = await assertSucceeds(getDocs(query(
    collection(selfDeleteFlow, "pushSubscriptions"),
    where("uid", "==", "self-delete-flow")
  )));
  assert.equal(retrySubscriptions.empty, true, "retry resumes cleanup behind the existing barrier");
  await assertFails(setDoc(doc(sameUserOtherDevice, "pushSubscriptions", IDS.selfDeleteFlow), data("self-delete-flow", "post-cleanup-recreate")));

  await assertFails(setDoc(doc(userA, "pushSubscriptions", "NOT-A-SHA256-ID"), data("user-a", "bad-id")));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.denied), { ...data("user-a", "extra"), username: "private-name" }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.denied), { ...data("user-a", "insecure"), endpoint: "http://push.example/insecure" }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.denied), { ...data("user-a", "long"), endpoint: `https://push.example/${"x".repeat(2049)}` }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.denied), { ...data("user-a", "bad-key"), p256dh: "bad+key" }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.denied), { ...data("user-a", "bad-auth"), auth: "" }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.denied), { ...data("user-a", "negative-expiration"), expirationTime: -1 }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.denied), { ...data("user-a", "float-expiration"), expirationTime: 1.5 }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.denied), { ...data("user-a", "client-time"), createdAt: new Date(), updatedAt: new Date() }));

  await assertSucceeds(updateDoc(doc(userA, "pushSubscriptions", IDS.own), {
    expirationTime: 123456,
    p256dh: "refreshed_p256dh",
    auth: "refreshed_auth",
    updatedAt: serverTimestamp()
  }));
  const current = (await getDoc(doc(userA, "pushSubscriptions", IDS.own))).data();
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.own), { ...current, uid: "user-b", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.own), { ...current, endpoint: "https://push.example/subscriptions/changed", updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(userA, "pushSubscriptions", IDS.own), { ...current, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(userA, "pushSubscriptions", IDS.own), { updatedAt: new Date() }));
  await assertFails(updateDoc(doc(userB, "pushSubscriptions", IDS.own), { updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(userB, "pushSubscriptions", IDS.own)));
  await assertSucceeds(deleteDoc(doc(userA, "pushSubscriptions", IDS.own)));
} finally {
  await testEnv.cleanup();
}

console.log("Push subscription Firestore authorization passed");
