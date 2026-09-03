import assert from "node:assert/strict";
import { createIdentityBundle, decryptPayload, derivePairwiseKey, encryptPayload, generateRoomKey, publicKeyFingerprint, unlockIdentityBundle, unwrapRoomKey, wrapRoomKey } from "../e2ee-crypto.mjs";

const alice = await createIdentityBundle("correct horse battery staple");
const bob = await createIdentityBundle("another strong chat password");
const alicePrivate = await unlockIdentityBundle(alice.privateBundle, "correct horse battery staple");
await assert.rejects(() => unlockIdentityBundle(alice.privateBundle, "this password is wrong"), /could not unlock/);

const context = "direct:alice:bob";
const aliceShared = await derivePairwiseKey(alicePrivate, bob.publicJwk, context);
const bobShared = await derivePairwiseKey(bob.privateKey, alice.publicJwk, context);
const envelope = await encryptPayload(aliceShared, { text: "secret message", imageData: "data:image/webp;base64,private" }, "message:example");
assert.equal(JSON.stringify(envelope).includes("secret message"), false, "ciphertext does not contain message text");
assert.deepEqual(await decryptPayload(bobShared, envelope, "message:example"), { text: "secret message", imageData: "data:image/webp;base64,private" });
await assert.rejects(() => decryptPayload(bobShared, { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -2)}aa` }, "message:example"));

const roomKey = await generateRoomKey();
const wrappedRoomKey = await wrapRoomKey(roomKey, aliceShared, "room-1", "bob");
const bobRoomKey = await unwrapRoomKey(wrappedRoomKey, bobShared, "room-1", "bob");
const roomMessage = await encryptPayload(roomKey, { text: "room secret" }, "room-message:1");
assert.deepEqual(await decryptPayload(bobRoomKey, roomMessage, "room-message:1"), { text: "room secret" });
assert.match(await publicKeyFingerprint(alice.publicJwk), /^(?:[0-9a-f]{4} ){5}[0-9a-f]{4}$/);

console.log("E2EE cryptographic primitives passed.");
