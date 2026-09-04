import assert from "node:assert/strict";
import {
  createTrustedDeviceRecord,
  pinDelayMs,
  trustedDeviceStorageKey,
  unlockTrustedDeviceRecord,
  validateChatPin
} from "../e2ee-pin.mjs";

assert.equal(validateChatPin("0000"), "0000");
assert.equal(validateChatPin("9876"), "9876");
for (const invalid of ["123", "12345", "12a4", " 1234", 1234, null, undefined]) {
  assert.throws(() => validateChatPin(invalid), /four digits/i);
}

const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
const record = await createTrustedDeviceRecord(privateJwk, "0420", { now: () => 1710000000000 });
const serialized = JSON.stringify(record);
assert.equal(serialized.includes("0420"), false, "trusted-device record must not contain plaintext PIN");
assert.equal(serialized.includes(privateJwk.d), false, "trusted-device record must not contain plaintext private key");
assert.equal(record.createdAt, 1710000000000);
assert.deepEqual(await unlockTrustedDeviceRecord(record, "0420"), privateJwk);
await assert.rejects(() => unlockTrustedDeviceRecord(record, "0421"), /incorrect/i);
await assert.rejects(
  () => unlockTrustedDeviceRecord({ ...record, wrappedDeviceKey: `${record.wrappedDeviceKey.slice(0, -2)}aa` }, "0420"),
  /incorrect|corrupt/i
);
await assert.rejects(
  () => unlockTrustedDeviceRecord({ ...record, wrappedPrivateJwk: `${record.wrappedPrivateJwk.slice(0, -2)}aa` }, "0420"),
  /incorrect|corrupt/i
);

assert.equal(trustedDeviceStorageKey("user-a"), "anonchat:e2ee:trusted-device:user-a");
assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(pinDelayMs), [0, 1000, 2000, 5000, 10000, 30000, 30000]);

console.log("E2EE four-digit PIN cryptography passed.");
