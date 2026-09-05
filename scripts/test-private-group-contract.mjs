import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../private-group-firestore.mjs", import.meta.url), "utf8");

for (const api of [
  "createPrivateGroup",
  "listPrivateGroupsForMember",
  "invitePrivateGroupMember",
  "removePrivateGroupMember",
  "loadPrivateGroupKey",
  "grantPrivateGroupKey"
]) {
  assert.match(source, new RegExp(`export\\s+const\\s+${api}\\b`), `private Group adapter exports ${api}`);
}

assert.match(source, /from\s+["']\.\/premium-policy\.mjs["']/, "private Groups reuse Premium policy");
assert.match(source, /\bhasPremiumAccess\b/, "private Group creation checks active Premium access");
assert.match(source, /from\s+["']\.\/group-policy\.mjs["']/, "private Groups reuse Group normalization");
assert.match(source, /visibility:\s*["']private["']/, "private Group records are explicitly private");
assert.match(source, /premiumRequired:\s*true/, "private Group records are marked Premium-required");
assert.match(source, /invitedBy:/, "private membership records require invitation provenance");
assert.match(source, /collectionGroup\(db,\s*["']members["']\)/, "member listing starts from Group membership rather than public discovery");
assert.doesNotMatch(source, /listPublicGroups/, "private Groups never use the public discovery path");

assert.match(source, /from\s+["']\.\/e2ee-identity\.js["']/, "private Groups reuse the existing E2EE identity system");
assert.match(source, /\bensureE2eeIdentity\b/, "private Groups unlock the existing E2EE identity");
assert.match(source, /from\s+["']\.\/e2ee-room-keys\.js["']/, "private Groups reuse room-key envelopes");
for (const primitive of ["createRoomKeyEnvelope", "loadRoomKey", "grantRoomKey"]) {
  assert.match(source, new RegExp(`\\b${primitive}\\b`), `private Groups reuse ${primitive}`);
}
assert.match(source, /["']privateGroup["']/, "private Groups use a dedicated E2EE room-key kind");
assert.match(source, /e2eeRoomKeyEnvelopes/, "owner key envelope is persisted with Group creation");

assert.doesNotMatch(source, /encryptPayload|decryptPayload/, "the Task 7 adapter handles keys only; encrypted discussion payloads belong to Task 8");
assert.doesNotMatch(source, /collection\(db,\s*["']users["']\)/, "private Group adapter does not mutate global user records");

console.log("private Group adapter contract tests passed");
