import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [identity, deviceStore, shell, controls] = await Promise.all([
  readFile(new URL("e2ee-identity.js", root), "utf8"),
  readFile(new URL("e2ee-device-key-store.mjs", root), "utf8").catch(() => ""),
  readFile(new URL("sw.js", root), "utf8"),
  readFile(new URL("controls.css", root), "utf8")
]);

assert.match(deviceStore, /indexedDB|IDBDatabase|IDBObjectStore/,
  "trusted-device auto-unlock uses IndexedDB");
assert.match(deviceStore, /AES-GCM|CryptoKey/,
  "trusted-device auto-unlock encrypts persisted identity material with Web Crypto");
assert.match(deviceStore, /extractable\s*[:=]\s*false|generateKey\([\s\S]{0,240}false\s*,/,
  "device wrapping key is non-exportable");
assert.doesNotMatch(deviceStore, /chat\s*pin|recovery\s*password/i,
  "device store does not persist raw PIN or recovery-password fields");
assert.doesNotMatch(deviceStore, /privateJwk\s*[:=]\s*privateJwk/,
  "device store does not persist a plaintext private JWK property");

assert.match(identity, /loadAutoUnlockIdentity/,
  "E2EE identity flow attempts device-local auto-unlock before prompting");
assert.match(identity, /saveAutoUnlockIdentity/,
  "successful trust establishment persists device-local auto-unlock state");
assert.match(identity, /clearE2eeSession[\s\S]*identityCache[\s\S]*pinAttempts/,
  "ordinary session teardown still clears only in-memory identity/PIN-attempt state");
assert.doesNotMatch(identity, /clearE2eeSession[\s\S]{0,500}removeAutoUnlockIdentity/,
  "ordinary sign-out does not erase trusted-device auto-unlock state");
assert.ok(shell.includes('"./e2ee-device-key-store.mjs"'),
  "PWA/TWA offline shell caches the persistent device-key store module");

assert.match(identity, /className\s*=\s*["']e2ee-password-dialog["']/,
  "encryption credential dialog keeps the existing AnonChat dialog class");
assert.match(identity, /className\s*=\s*["']e2ee-password-actions["']/,
  "encryption credential actions keep the existing AnonChat action class");
assert.match(controls, /:where\(button,.primary-button,.secondary-button/,
  "shared AnonChat button theme remains authoritative for dialog buttons");

console.log("trusted-device E2EE auto-unlock contract passed");
