import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const [identity, cryptoSource, pinSource, storeSource, sw] = await Promise.all([
  "e2ee-identity.js",
  "e2ee-crypto.mjs",
  "e2ee-pin.mjs",
  "e2ee-device-store.mjs",
  "sw.js"
].map(read));

assert.match(identity, /Create chat PIN/);
assert.match(identity, /Enter chat PIN/);
assert.match(identity, /recoveryPassphraseDialog/);
assert.match(identity, /loadTrustedDeviceRecord/);
assert.match(identity, /saveTrustedDeviceRecord/);
assert.match(identity, /unlockTrustedDeviceRecord/);
assert.match(identity, /unlockIdentityBundleJwk/);
assert.match(identity, /clearE2eeSession/);
assert.doesNotMatch(identity, /batch[.]set\([\s\S]{0,500}(?:chatPin|pinSalt|wrappedDeviceKey|wrappedPrivateJwk)/i,
  "PIN-only trusted-device material must never be written to Firestore");
assert.match(cryptoSource, /unlockIdentityBundleJwk/);
assert.match(pinSource, /randomBytes\(32\)/, "trusted-device wrapping key must have 256 bits of random key material");
assert.match(pinSource, /PBKDF2/);
assert.match(pinSource, /AES-GCM/);
assert.match(storeSource, /TrustedDeviceStateError/);
assert.ok(sw.includes('"./e2ee-pin.mjs"'), "PWA cache must include PIN crypto module");
assert.ok(sw.includes('"./e2ee-device-store.mjs"'), "PWA cache must include trusted-device store module");

console.log("E2EE four-digit PIN integration policy passed.");
