import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const [community, premium, rules, terms, privacy, shell] = await Promise.all([
  "community.js", "premium-rooms.js", "firestore.rules", "terms.html", "privacy.html", "sw.js"
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

console.log("E2EE integration policy passed.");
