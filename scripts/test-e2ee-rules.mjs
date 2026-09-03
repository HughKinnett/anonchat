import { readFile } from "node:fs/promises";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "anonchat-e2ee-rules-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});
const profile = uid => ({ uid, username: uid, banned: false, createdAt: new Date(0), lastActiveAt: new Date(0) });
const publicKey = uid => ({ uid, version: 1, algorithm: "P-256", publicJwk: { key_ops: [], ext: true, kty: "EC", x: "x".repeat(43), y: "y".repeat(43), crv: "P-256" }, fingerprint: "aaaa bbbb cccc dddd eeee ffff", createdAt: new Date(0) });
const cipher = value => ({ version: 1, algorithm: "A256GCM", iv: "a".repeat(16), ciphertext: Buffer.from(value).toString("base64") });
const envelope = (kind, roomId, recipientUid, senderUid) => ({ kind, roomId, recipientUid, senderUid, envelope: cipher("wrapped-room-key"), version: 1, createdAt: serverTimestamp() });

try {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all(["alice", "bob", "outsider"].map(uid => setDoc(doc(db, "users", uid), profile(uid))));
    await Promise.all(["alice", "bob", "outsider"].map(uid => setDoc(doc(db, "e2eePublicKeys", uid), publicKey(uid))));
    await setDoc(doc(db, "e2eePrivateKeys", "alice"), { uid: "alice", secret: "wrapped" });
    await setDoc(doc(db, "messageRequests", "alice_bob"), { fromId: "alice", toId: "bob", status: "accepted", createdAt: new Date(0) });
    await Promise.all(["alice", "bob"].map(uid => setDoc(doc(db, "premiumAccess", uid), { uid, status: "active", tier: "subscriber" })));
  });

  const verifiedContext = uid => env.authenticatedContext(uid, {
    email: `${uid}@example.test`, email_verified: true
  }).firestore();
  const alice = verifiedContext("alice");
  const bob = verifiedContext("bob");
  const outsider = verifiedContext("outsider");
  await assertSucceeds(getDoc(doc(bob, "e2eePublicKeys", "alice")));
  await assertFails(getDoc(doc(bob, "e2eePrivateKeys", "alice")));
  await assertSucceeds(getDoc(doc(alice, "e2eePrivateKeys", "alice")));

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const roomBatch = writeBatch(alice);
  roomBatch.set(doc(alice, "rooms", "encrypted-room"), { name: "Encrypted room", topic: "private", ownerId: "alice", encrypted: true, cipherVersion: 1, createdAt: serverTimestamp(), expiresAt, moderationState: "visible" });
  roomBatch.set(doc(alice, "roomMembers", "encrypted-room_alice"), { roomId: "encrypted-room", uid: "alice", joinedAt: serverTimestamp() });
  roomBatch.set(doc(alice, "e2eeRoomKeyEnvelopes", "temporary_encrypted-room_alice"), envelope("temporary", "encrypted-room", "alice", "alice"));
  await assertSucceeds(roomBatch.commit());
  await assertSucceeds(setDoc(doc(bob, "roomMembers", "encrypted-room_bob"), { roomId: "encrypted-room", uid: "bob", joinedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(alice, "e2eeRoomKeyEnvelopes", "temporary_encrypted-room_bob"), envelope("temporary", "encrypted-room", "bob", "alice")));
  await assertFails(getDoc(doc(outsider, "e2eeRoomKeyEnvelopes", "temporary_encrypted-room_bob")));
  await assertSucceeds(setDoc(doc(bob, "roomMessages", "encrypted-message"), { roomId: "encrypted-room", senderId: "bob", tempName: "Hidden Otter", encrypted: true, cipherVersion: 1, bodyCipher: cipher("secret"), expiresAt, moderationState: "visible", createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(bob, "roomMessages", "plaintext-message"), { roomId: "encrypted-room", senderId: "bob", tempName: "Hidden Otter", text: "plaintext", expiresAt, moderationState: "visible", createdAt: serverTimestamp() }));

  await assertSucceeds(setDoc(doc(alice, "messageRequests", "alice_bob", "messages", "encrypted-direct"), { participants: ["alice", "bob"], senderId: "alice", encrypted: true, cipherVersion: 1, bodyCipher: cipher("private"), createdAt: serverTimestamp() }));
  await assertFails(getDoc(doc(outsider, "messageRequests", "alice_bob", "messages", "encrypted-direct")));

  const premiumBatch = writeBatch(alice);
  premiumBatch.set(doc(alice, "premiumRooms", "premium-room"), { name: "Premium room", topic: "private", roomColor: "purple", ownerId: "alice", moderatorIds: [], encrypted: true, cipherVersion: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), moderationState: "visible" });
  premiumBatch.set(doc(alice, "premiumRoomMembers", "premium-room_alice"), { roomId: "premium-room", uid: "alice", role: "owner", invitedBy: "alice", joinedAt: serverTimestamp() });
  premiumBatch.set(doc(alice, "e2eeRoomKeyEnvelopes", "premium_premium-room_alice"), envelope("premium", "premium-room", "alice", "alice"));
  await assertSucceeds(premiumBatch.commit());
  await assertSucceeds(setDoc(doc(alice, "premiumRooms", "premium-room", "messages", "encrypted-premium"), { senderId: "alice", username: "alice", encrypted: true, cipherVersion: 1, bodyCipher: cipher("premium secret"), createdAt: serverTimestamp() }));
  await assertFails(setDoc(doc(alice, "premiumRooms", "premium-room", "messages", "plaintext-premium"), { senderId: "alice", username: "alice", text: "plaintext", createdAt: serverTimestamp() }));

  console.log("E2EE Firestore authorization passed.");
} finally {
  await env.cleanup();
}
