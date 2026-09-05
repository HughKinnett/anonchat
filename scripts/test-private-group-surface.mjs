import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Task 8 final verification runs this contract on the secured branch head.
const html = await readFile(new URL("../group-detail.html", import.meta.url), "utf8");
const js = await readFile(new URL("../private-group-detail.js", import.meta.url), "utf8");
const publicJs = await readFile(new URL("../group-detail.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

for (const api of [
  "listPrivateGroupsForMember",
  "invitePrivateGroupMember",
  "removePrivateGroupMember",
  "loadPrivateGroupKey",
  "grantPrivateGroupKey"
]) {
  assert.match(js, new RegExp(`\\b${api}\\b`), `Private Group detail consumes ${api}`);
}

assert.match(js, /ensureE2eeIdentity/, "private Group detail reuses the existing E2EE identity flow");
assert.match(js, /encryptPayload/, "private Group messages are encrypted before write");
assert.match(js, /decryptPayload/, "private Group messages are decrypted for members");
assert.match(js, /bodyCipher/, "private Group messages store encrypted payloads");
assert.match(js, /private-group-message:/, "private Group message encryption uses a scoped associated-data context");
assert.doesNotMatch(js, /setDoc\([^)]*messageRef[\s\S]{0,500}\btext\s*:/, "private Group message writes do not include plaintext text payloads");
assert.match(js, /currentGroup\.visibility\s*!==\s*["']private["']|currentGroup\.visibility\s*===\s*["']private["']/, "private Group rendering is explicitly gated by private visibility");
assert.match(js, /currentMembership/, "private Group surface requires membership state");
assert.match(js, /invitePrivateGroupMember/, "private Group staff can invite members");
assert.match(js, /removePrivateGroupMember/, "private Group staff can remove members");
assert.match(js, /createModerationClient|moderation\?\./, "private Group surface reuses shared moderation/blocking controls");
assert.match(js, /exitAfterAuthLoss/, "private Group surface preserves shared auth-loss cleanup");
assert.match(html, /id=["']private-group-panel["']/, "Group detail contains a dedicated private Group panel");
assert.match(html, /src=["']private-group-detail\.js["']/, "Group detail loads the focused private Group controller");

assert.match(rules, /match \/groups\/\{groupId\}\/privateGroupMessages\/\{messageId\}/, "Firestore rules scope private Group messages under the Group");
assert.match(rules, /privateGroupMessages[\s\S]*isGroupMember\(groupId, request\.auth\.uid\)/, "private Group message reads require Group membership");
assert.match(rules, /privateGroupMessages[\s\S]*request\.resource\.data\.encrypted\s*==\s*true/, "private Group message creation requires encrypted payloads");
assert.match(rules, /privateGroupMessages[\s\S]*request\.resource\.data\.keys\(\)\.hasOnly\(\['senderId', 'encrypted', 'cipherVersion', 'bodyCipher', 'createdAt'\]\)/, "private Group messages cannot store plaintext fields");
assert.match(rules, /resource\.data\.kind == 'privateGroup'[\s\S]*isGroupMember\(resource\.data\.roomId, request\.auth\.uid\)/, "private Group key envelopes are readable only by Group members");
assert.match(rules, /request\.resource\.data\.kind in \['temporary', 'premium', 'privateGroup'\]/, "privateGroup is an allowed E2EE room-key scope");
assert.match(rules, /request\.resource\.data\.groupId is string[\s\S]{0,250}groupPublicAfter\(request\.resource\.data\.groupId\)/, "canonical Group posts are limited to public Groups so private discussions cannot fall back to plaintext");
assert.match(publicJs, /currentGroup\?\.visibility\s*===\s*["']private["'][\s\S]{0,250}(?:return|composer\.hidden\s*=\s*true)/, "public Group controller explicitly refuses the plaintext composer for private Groups");

assert.match(sw, /group-detail\.html/, "Group detail remains available in the offline graph");
assert.match(sw, /group-detail\.js/, "public Group detail remains available in the offline graph");
assert.match(sw, /private-group-detail\.js/, "private Group controller is available in the offline graph");

console.log("Private Group encrypted surface contract tests passed");
