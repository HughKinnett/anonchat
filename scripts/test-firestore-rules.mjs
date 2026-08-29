import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-message-request-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const users = ["user-a", "user-b", "user-c"];
const requestPath = "messageRequests/user-a_user-b";
const profile = (uid) => ({ uid, username: uid.replace("-", "_"), banned: false });
const declinedRequest = { fromId: "user-a", toId: "user-b", status: "declined", createdAt: new Date(0), respondedAt: new Date(1) };

const seed = async (request = declinedRequest) => testEnv.withSecurityRulesDisabled(async (context) => {
  await Promise.all(users.map((uid) => setDoc(doc(context.firestore(), "users", uid), profile(uid))));
  await setDoc(doc(context.firestore(), requestPath), request);
});

try {
  await seed();
  const userB = testEnv.authenticatedContext("user-b").firestore();
  await assertSucceeds(updateDoc(doc(userB, requestPath), {
    fromId: "user-b", toId: "user-a", status: "pending", createdAt: serverTimestamp()
  }));
  assert.equal((await getDoc(doc(userB, requestPath))).data().fromId, "user-b");

  await testEnv.clearFirestore();
  await seed();
  const userA = testEnv.authenticatedContext("user-a").firestore();
  await assertSucceeds(updateDoc(doc(userA, requestPath), {
    fromId: "user-a", toId: "user-b", status: "pending", createdAt: serverTimestamp()
  }));

  await testEnv.clearFirestore();
  await seed({ ...declinedRequest, status: "accepted" });
  await assertFails(updateDoc(doc(userB, requestPath), {
    fromId: "user-b", toId: "user-a", status: "pending", createdAt: serverTimestamp()
  }));

  await testEnv.clearFirestore();
  await seed();
  const userC = testEnv.authenticatedContext("user-c").firestore();
  await assertFails(updateDoc(doc(userC, requestPath), {
    fromId: "user-c", toId: "user-a", status: "pending", createdAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(userB, requestPath), {
    fromId: "user-b", toId: "user-c", status: "pending", createdAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(userB, requestPath), {
    fromId: "user-b", toId: "user-a", status: "pending", createdAt: serverTimestamp(), injected: true
  }));

  await testEnv.withSecurityRulesDisabled(async (context) => setDoc(
    doc(context.firestore(), "blocks", "user-a_user-b"),
    { blockerUid: "user-a", blockedUid: "user-b", createdAt: new Date(0) }
  ));
  await assertFails(updateDoc(doc(userB, requestPath), {
    fromId: "user-b", toId: "user-a", status: "pending", createdAt: serverTimestamp()
  }));

  await testEnv.clearFirestore();
  await seed({ ...declinedRequest, status: "pending" });
  await assertSucceeds(updateDoc(doc(userB, requestPath), {
    status: "accepted", respondedAt: serverTimestamp()
  }));

  await testEnv.clearFirestore();
  await seed({ ...declinedRequest, status: "pending" });
  await assertFails(updateDoc(doc(userA, requestPath), {
    status: "accepted", respondedAt: serverTimestamp()
  }));
  await assertFails(updateDoc(doc(userC, requestPath), {
    status: "accepted", respondedAt: serverTimestamp()
  }));

  // Accepted private chats are readable only by their two participants.
  await testEnv.clearFirestore();
  await seed({ ...declinedRequest, status: "accepted" });
  await testEnv.withSecurityRulesDisabled(async (context) => setDoc(
    doc(context.firestore(), "directMessages", "accepted-message"),
    {
      participants: ["user-a", "user-b"],
      senderId: "user-a",
      text: "private",
      createdAt: new Date(2)
    }
  ));
  await assertSucceeds(getDoc(doc(userA, "directMessages", "accepted-message")));
  await assertSucceeds(getDoc(doc(userB, "directMessages", "accepted-message")));
  await assertFails(getDoc(doc(userC, "directMessages", "accepted-message")));

  // Participants cannot read messages until the request is accepted.
  await testEnv.clearFirestore();
  await seed({ ...declinedRequest, status: "pending" });
  await testEnv.withSecurityRulesDisabled(async (context) => setDoc(
    doc(context.firestore(), "directMessages", "pending-message"),
    {
      participants: ["user-a", "user-b"],
      senderId: "user-a",
      text: "not yet available",
      createdAt: new Date(2)
    }
  ));
  await assertFails(getDoc(doc(userA, "directMessages", "pending-message")));
  await assertFails(getDoc(doc(userB, "directMessages", "pending-message")));

  console.log("Firestore message request authorization regressions passed");
} finally {
  await testEnv.cleanup();
}
