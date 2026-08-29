import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

const testEnv = await initializeTestEnvironment({
  projectId: "anonchat-room-expiry-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});
const profile = (uid) => ({ uid, username: uid, banned: false, createdAt: new Date(0), lastActiveAt: new Date(0) });
const expiresSoon = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const room = (overrides = {}) => ({ name: "Expiry room", topic: "topic", ownerId: "owner", createdAt: serverTimestamp(), expiresAt: expiresSoon(), moderationState: "visible", ...overrides });
const seed = () => testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await Promise.all([
    setDoc(doc(db, "users", "owner"), profile("owner")), setDoc(doc(db, "users", "member"), profile("member")),
    setDoc(doc(db, "rooms", "expired-room"), { name: "Expired", topic: "topic", ownerId: "owner", createdAt: new Date(0), expiresAt: new Date(0) }),
    setDoc(doc(db, "rooms", "leased-room"), { name: "Leased", topic: "topic", ownerId: "owner", createdAt: new Date(0), expiresAt: new Date(0), cleanupLeaseToken: "trusted", cleanupLeaseExpiresAt: new Date(Date.now() + 60_000) }),
    setDoc(doc(db, "roomMessages", "leased-message"), { roomId: "leased-room", senderId: "member" }), setDoc(doc(db, "roomMembers", "leased-member"), { roomId: "leased-room", uid: "member" }),
    setDoc(doc(db, "rooms", "malformed-room"), { name: "Malformed", topic: "topic", ownerId: "owner", createdAt: new Date(0), expiresAt: "never" })
  ]);
});

try {
  await seed();
  const owner = testEnv.authenticatedContext("owner").firestore();
  const member = testEnv.authenticatedContext("member").firestore();
  await assertSucceeds(setDoc(doc(owner, "rooms", "active-room"), room()));
  const activeRoom = await getDoc(doc(owner, "rooms", "active-room"));
  const activeExpiry = activeRoom.data().expiresAt;
  await assertSucceeds(setDoc(doc(member, "roomMembers", "active-room_member"), { roomId: "active-room", uid: "member", joinedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(member, "roomMessages", "active-message"), { roomId: "active-room", senderId: "member", tempName: "Member", text: "active", expiresAt: activeExpiry, moderationState: "visible", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(owner, "rooms", "client-created"), room({ createdAt: new Date() })));
  await assertFails(setDoc(doc(owner, "rooms", "too-short"), room({ expiresAt: new Date(Date.now() + 60 * 60 * 1000) })));
  await assertFails(setDoc(doc(owner, "rooms", "too-long"), room({ expiresAt: new Date(Date.now() + 30 * 60 * 60 * 1000) })));
  await assertFails(setDoc(doc(owner, "rooms", "missing-expiry"), { name: "Missing", topic: "topic", ownerId: "owner", createdAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(owner, "rooms", "active-room")), "room owners cannot strand children during trusted cleanup");
  await assertFails(deleteDoc(doc(owner, "rooms", "leased-room")), "room owners cannot remove a leased parent before trusted child cleanup");
  await assertFails(setDoc(doc(member, "roomMessages", "wrong-expiry"), { roomId: "active-room", senderId: "member", tempName: "Member", text: "wrong", expiresAt: expiresSoon(), moderationState: "visible", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(member, "roomMessages", "missing-message-expiry"), { roomId: "active-room", senderId: "member", tempName: "Member", text: "wrong", moderationState: "visible", createdAt: serverTimestamp() }));
  for (const roomId of ["expired-room", "malformed-room"]) {
    await assertFails(setDoc(doc(member, "roomMembers", `${roomId}_member`), { roomId, uid: "member", joinedAt: serverTimestamp() }));
    await assertFails(setDoc(doc(member, "roomMessages", `${roomId}-message`), { roomId, senderId: "member", tempName: "Member", text: "expired", expiresAt: new Date(0), moderationState: "visible", createdAt: serverTimestamp() }));
  }
  console.log("Firestore room expiry authorization passed");
} finally {
  await testEnv.cleanup();
}
