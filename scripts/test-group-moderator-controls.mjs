import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const js = await readFile(new URL("../group-detail.js", import.meta.url), "utf8");
const adapter = await readFile(new URL("../group-firestore.mjs", import.meta.url), "utf8");

for (const api of ["setGroupModerator", "removeGroupMember", "setGroupPostPinned"]) {
  assert.match(js, new RegExp(`\\b${api}\\b`), `Group detail consumes ${api}`);
}

assert.match(js, /currentMembership\?\.role\s*===\s*["']owner["']/, "owner role gates moderator management");
assert.match(js, /currentMembership\?\.role\s*===\s*["']moderator["']/, "moderator role is recognized as scoped staff");
assert.match(js, /Make moderator/, "owners can promote a Group member to moderator");
assert.match(js, /Remove moderator/, "owners can demote a Group moderator");
assert.match(js, /Remove member/, "Group staff can remove eligible members");
assert.match(js, /Owner role cannot be removed|Group owner cannot be removed|owner.*cannot.*removed/i, "owner protection is visible in the staff controls");
assert.match(js, /Owner/, "owner role labels are visible");
assert.match(js, /Moderator/, "moderator role labels are visible");
assert.match(js, /Member/, "member role labels are visible");
assert.match(js, /setGroupPostPinned/, "pin and unpin stays on the scoped Group API");

assert.match(adapter, /canManageGroup\(actor\.data\(\)\)/, "adapter limits moderator-role changes to the Group owner");
assert.match(adapter, /canModerateGroup\(actor\.data\(\)\)/, "adapter limits member removal to Group-scoped staff");
assert.match(adapter, /current\.data\(\)\.role\s*===\s*["']owner["']/, "adapter protects the owner from removal");
assert.match(adapter, /actor\.data\(\)\.role\s*===\s*["']moderator["'].*current\.data\(\)\.role\s*!==\s*["']member["']/s, "moderators cannot remove owners or other moderators");

assert.doesNotMatch(js, /collection\(db,\s*["']users["']\).*update|updateDoc\(doc\(db,\s*["']users["']/s, "Group controls do not mutate global user privilege documents");
assert.doesNotMatch(js, /\badmin\b\s*[:=]/i, "Group controls do not assign global admin privileges");

console.log("Group moderator controls contract tests passed");
