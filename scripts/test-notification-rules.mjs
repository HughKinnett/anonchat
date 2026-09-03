import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-notification-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});
const event = { type: "reaction", actorUid: "actor", recipientUid: "recipient", route: "/timeline.html", status: "pending", attempts: 0, createdAt: new Date(0), updatedAt: new Date(0), sourceCreatedAt: new Date(0) };
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, "users", "recipient"), { uid: "recipient", username: "recipient_name", banned: false });
  await setDoc(doc(db, "users", "actor"), { uid: "actor", username: "actor_name", banned: false });
  await setDoc(doc(db, "users", "admin"), { uid: "admin", username: "i_love_you_h", banned: false });
  await setDoc(doc(db, "usernames", "i_love_you_h"), { uid: "admin", username: "i_love_you_h" });
  await setDoc(doc(db, "notificationEvents", "event"), event);
  await setDoc(doc(db, "notificationDeliveries", "delivery"), { eventId: "event", recipientUid: "recipient", subscriptionId: "sub", status: "delivered", createdAt: new Date(0), updatedAt: new Date(0) });
  await setDoc(doc(db, "system", "notificationProcessor"), { status: "completed", updatedAt: new Date(0) });
});

try {
  const contexts = [
    testEnv.authenticatedContext("recipient", { email_verified: true }).firestore(),
    testEnv.authenticatedContext("actor", { email_verified: true }).firestore(),
    testEnv.authenticatedContext("admin", { email_verified: true }).firestore(),
    testEnv.authenticatedContext("ordinary", { email_verified: true }).firestore(),
    testEnv.unauthenticatedContext().firestore()
  ];
  for (const db of contexts) {
    for (const path of ["notificationEvents/event", "notificationDeliveries/delivery", "system/notificationProcessor"]) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), event));
      await assertFails(updateDoc(doc(db, path), { status: "forged" }));
      await assertFails(deleteDoc(doc(db, path)));
    }
    await assertFails(getDocs(collection(db, "notificationEvents")));
    await assertFails(getDocs(collection(db, "notificationDeliveries")));
  }
  const recipient = testEnv.authenticatedContext("recipient", { email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(recipient, "notificationReads", "recipient_event-1234abcd1234abcd"), {
    uid: "recipient",
    eventId: "event-1234abcd1234abcd",
    readAt: serverTimestamp()
  }));
  await assertFails(setDoc(doc(recipient, "notificationReads", "recipient_forged"), {
    uid: "recipient",
    reactionId: "forged",
    readAt: serverTimestamp()
  }));
  console.log("Notification server-only Firestore authorization passed");
} finally {
  await testEnv.cleanup();
}
