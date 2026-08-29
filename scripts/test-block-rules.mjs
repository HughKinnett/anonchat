import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-block-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});
const profile = (uid) => ({ uid, username: uid, banned: false, createdAt: new Date(0), lastActiveAt: new Date(0) });
const block = (blockerUid = "blocker", blockedUid = "blocked") => ({ blockerUid, blockedUid, createdAt: serverTimestamp() });
const seed = () => testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await Promise.all([
    setDoc(doc(db, "users", "blocker"), profile("blocker")), setDoc(doc(db, "users", "blocked"), profile("blocked")), setDoc(doc(db, "users", "stranger"), profile("stranger")),
    setDoc(doc(db, "rooms", "blocker-room"), { name: "Blocker room", topic: "topic", ownerId: "blocker", createdAt: new Date(0), expiresAt: new Date(Date.now() + 86_400_000) }),
    setDoc(doc(db, "messageRequests", "blocker_blocked"), { fromId: "blocker", toId: "blocked", status: "accepted", createdAt: new Date(0) })
  ]);
});

try {
  await seed();
  const blocker = testEnv.authenticatedContext("blocker").firestore();
  const blocked = testEnv.authenticatedContext("blocked").firestore();
  const stranger = testEnv.authenticatedContext("stranger").firestore();
  const unauthenticated = testEnv.unauthenticatedContext().firestore();
  const blockRef = doc(blocker, "blocks", "blocker_blocked");
  await assertSucceeds(setDoc(blockRef, block()));
  await assertSucceeds(getDoc(doc(blocked, "blocks", "blocker_blocked")));
  const incoming = await assertSucceeds(getDocs(query(collection(blocked, "blocks"), where("blockedUid", "==", "blocked"))));
  if (incoming.size !== 1) throw new Error("blocked user must receive the incoming block snapshot");
  await assertFails(getDoc(doc(stranger, "blocks", "blocker_blocked")));
  await assertFails(getDoc(doc(unauthenticated, "blocks", "blocker_blocked")));
  await assertFails(setDoc(doc(unauthenticated, "blocks", "blocker_blocked"), block()));
  await assertFails(deleteDoc(doc(unauthenticated, "blocks", "blocker_blocked")));
  await assertFails(setDoc(doc(blocker, "blocks", "blocker_blocker"), block("blocker", "blocker")));
  await assertFails(setDoc(doc(stranger, "blocks", "blocker_blocked"), block()));
  await assertFails(setDoc(doc(blocker, "blocks", "wrong"), block()));
  await assertFails(updateDoc(blockRef, { blockedUid: "stranger" }));

  await assertFails(setDoc(doc(blocker, "follows", "blocker_blocked"), { followerId: "blocker", followingId: "blocked", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(blocked, "follows", "blocked_blocker"), { followerId: "blocked", followingId: "blocker", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(blocked, "messageRequests", "blocked_blocker"), { fromId: "blocked", toId: "blocker", status: "pending", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(blocked, "directMessages", "blocked-message"), { participants: ["blocked", "blocker"], senderId: "blocked", text: "blocked", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(blocked, "reveals", "blocked_blocker"), { fromId: "blocked", toId: "blocker", fields: { interests: true }, status: "pending", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(blocked, "roomMembers", "blocker-room_blocked"), { roomId: "blocker-room", uid: "blocked", joinedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(blocked, "roomMessages", "blocked-room-message"), { roomId: "blocker-room", senderId: "blocked", tempName: "Blocked", text: "blocked", expiresAt: new Date(Date.now() + 86_400_000), moderationState: "visible", createdAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(blockRef));
  console.log("Firestore block authorization passed");
} finally {
  await testEnv.cleanup();
}
