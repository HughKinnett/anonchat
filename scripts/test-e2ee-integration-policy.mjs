import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const [community, premium, rules, terms, privacy, shell, identity] = await Promise.all([
  "community.js", "premium-rooms.js", "firestore.rules", "terms.html", "privacy.html", "sw.js",
  "e2ee-identity.js"
].map(read));

for (const surface of [community, premium]) {
  assert.match(surface, /ensureE2eeIdentity/);
  assert.match(surface, /encryptPayload/);
  assert.match(surface, /decryptPayload/);
}
assert.match(community, /bodyCipher = await encryptPayload\(key/);
assert.match(community, /bodyCipher = await encryptPayload\(activeTemporaryRoomKey/);
assert.doesNotMatch(community, /senderId: state[.]user[.]uid,\s*text,\s*[.][.][.]\(pendingDirectImage/,
  "new private messages never send plaintext bodies");
assert.match(premium, /bodyCipher = await encryptPayload\(activeRoomKey/);
assert.match(rules, /match \/e2eePublicKeys\/\{uid\}/);
assert.match(rules, /match \/e2eePrivateKeys\/\{uid\}/);
assert.match(rules, /match \/e2eeRoomKeyEnvelopes\/\{envelopeId\}/);
assert.match(rules, /match \/directMessages\/\{messageId\}[\s\S]*?allow create: if false;/,
  "the retired plaintext direct-message path cannot accept new writes");
assert.match(terms, /cannot decrypt end-to-end encrypted message contents/);
assert.match(privacy, /may disclose ciphertext and metadata it possesses, but it cannot disclose plaintext that it cannot decrypt/);
for (const asset of ["e2ee-crypto.mjs", "e2ee-identity.js", "e2ee-room-keys.js"]) assert.ok(shell.includes(`"./${asset}"`));

assert.match(identity, /e2ee-recovery-warning/,
  "credential setup renders a dedicated recovery warning");
assert.match(identity, /AnonChat does not store your encryption password or PIN in a recoverable form/,
  "setup tells users the service cannot retrieve their encryption credentials");
assert.match(identity, /cannot recover, reset, or tell you what they are/,
  "setup explicitly states AnonChat cannot recover lost credentials");
assert.match(identity, /I understand that AnonChat cannot recover my encryption password or PIN/,
  "setup requires an explicit unrecoverable-credential acknowledgment");
assert.match(identity, /acknowledgment\.required = setup/,
  "credential acknowledgment is required during password and PIN creation");
assert.match(identity, /recoveryWarning\.style\.color = "#fca5a5"/,
  "the unrecoverable-credential warning uses prominent red text");
assert.match(identity, /recoveryWarning\.style\.border = "1px solid #ef4444"/,
  "the unrecoverable-credential warning has a red border");
assert.match(identity, /acknowledgmentLabel\.style\.color = "#fca5a5"/,
  "the acknowledgment remains visually tied to the red warning");

console.log("E2EE integration policy passed.");
