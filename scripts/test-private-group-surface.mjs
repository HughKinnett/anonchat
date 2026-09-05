import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../group-detail.html", import.meta.url), "utf8");
const js = await readFile(new URL("../group-detail.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

for (const api of [
  "listPrivateGroupsForMember",
  "invitePrivateGroupMember",
  "removePrivateGroupMember",
  "loadPrivateGroupKey",
  "grantPrivateGroupKey"
]) {
  assert.match(js, new RegExp(`\\b${api}\\b`), `Group detail consumes ${api}`);
}

assert.match(js, /ensureE2eeIdentity/, "private Group detail reuses the existing E2EE identity flow");
assert.match(js, /encryptPayload/, "private Group messages are encrypted before write");
assert.match(js, /decryptPayload/, "private Group messages are decrypted for members");
assert.match(js, /bodyCipher/, "private Group messages store encrypted payloads");
assert.match(js, /private-group-message:/, "private Group message encryption uses a scoped associated-data context");
assert.doesNotMatch(js, /privateGroupMessages[\s\S]{0,800}\btext\s*:/, "private Group message writes do not include plaintext text payloads");
assert.match(js, /currentGroup\?\.visibility\s*===\s*["']private["']|currentGroup\.visibility\s*===\s*["']private["']/, "private Group rendering is explicitly gated by private visibility");
assert.match(js, /currentMembership/, "private Group surface requires membership state");
assert.match(js, /invitePrivateGroupMember/, "private Group staff can invite members");
assert.match(js, /removePrivateGroupMember/, "private Group staff can remove members");
assert.match(js, /createModerationClient|moderation\?\./, "private Group surface reuses shared moderation/blocking controls");
assert.match(js, /exitAfterAuthLoss/, "private Group surface preserves shared auth-loss cleanup");
assert.match(html, /Private Group|private group/i, "Group detail exposes private Group status to the member");
assert.match(sw, /group-detail\.html/, "Group detail remains available in the offline graph");
assert.match(sw, /group-detail\.js/, "Group detail controller remains available in the offline graph");

console.log("Private Group encrypted surface contract tests passed");
