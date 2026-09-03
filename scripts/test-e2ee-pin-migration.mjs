import assert from "node:assert/strict";
import {
  createIdentityBundle,
  decryptPayload,
  derivePairwiseKey,
  encryptPayload,
  generateRoomKey,
  importPrivateKeyJwk,
  publicKeyFingerprint,
  unlockIdentityBundleJwk,
  unwrapRoomKey,
  wrapRoomKey
} from "../e2ee-crypto.mjs";
import { createTrustedDeviceRecord, unlockTrustedDeviceRecord } from "../e2ee-pin.mjs";

const alice = await createIdentityBundle("alice legacy recovery password");
const bob = await createIdentityBundle("bob legacy recovery password");
const originalFingerprint = await publicKeyFingerprint(alice.publicJwk);

// Create ciphertext before Alice migrates to the four-digit trusted-device PIN flow.
const originalAlicePrivate = await importPrivateKeyJwk(await unlockIdentityBundleJwk(alice.privateBundle, "alice legacy recovery password"));
const directContext = "direct:alice:bob";
const originalPairwise = await derivePairwiseKey(originalAlicePrivate, bob.publicJwk, directContext);
const bobPairwise = await derivePairwiseKey(bob.privateKey, alice.publicJwk, directContext);
const oldDirectMessage = await encryptPayload(bobPairwise, { text: "message from before PIN migration" }, "message:old-direct");

const roomKey = await generateRoomKey();
const oldRoomEnvelope = await wrapRoomKey(roomKey, bobPairwise, "room-before-pin", "alice");
const oldRoomMessage = await encryptPayload(roomKey, { text: "room message from before PIN migration" }, "room-message:old");

// Migration unlocks the same legacy private bundle once, creates a local PIN record,
// then normal trusted-device unlocks recover the same private identity.
const migratedPrivateJwk = await unlockIdentityBundleJwk(alice.privateBundle, "alice legacy recovery password");
const trustedRecord = await createTrustedDeviceRecord(migratedPrivateJwk, "0420");
const pinUnlockedJwk = await unlockTrustedDeviceRecord(trustedRecord, "0420");
const pinUnlockedPrivate = await importPrivateKeyJwk(pinUnlockedJwk);

assert.equal(pinUnlockedJwk.d, migratedPrivateJwk.d, "PIN migration must preserve the private E2EE identity");
assert.equal(await publicKeyFingerprint(alice.publicJwk), originalFingerprint, "PIN migration must not rotate the public identity fingerprint");

const migratedPairwise = await derivePairwiseKey(pinUnlockedPrivate, bob.publicJwk, directContext);
assert.deepEqual(
  await decryptPayload(migratedPairwise, oldDirectMessage, "message:old-direct"),
  { text: "message from before PIN migration" },
  "old direct messages remain decryptable after PIN migration"
);
const migratedRoomKey = await unwrapRoomKey(oldRoomEnvelope, migratedPairwise, "room-before-pin", "alice");
assert.deepEqual(
  await decryptPayload(migratedRoomKey, oldRoomMessage, "room-message:old"),
  { text: "room message from before PIN migration" },
  "old room messages remain decryptable after PIN migration"
);

console.log("E2EE four-digit PIN migration compatibility passed.");
