import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.match(rules, /match \/groups\/\{groupId\}/, "groups collection has explicit rules");
assert.match(rules, /match \/groups\/\{groupId\}\/members\/\{userId\}/, "group members have explicit rules");
assert.match(rules, /visibility\s*==\s*['"]public['"]/, "public Group rules recognize public visibility");
assert.match(rules, /visibility\s*==\s*['"]private['"]/, "private Group rules recognize private visibility");
assert.match(rules, /premiumRequired\s*==\s*false/, "public Group creation is free");
assert.match(rules, /premiumRequired\s*==\s*true/, "private Group documents are marked Premium-only");
assert.match(rules, /ownerId\s*==\s*request\.auth\.uid/, "Group creation binds owner identity to the caller");
assert.match(rules, /role\s+in\s+\[['"]owner['"],\s*['"]moderator['"],\s*['"]member['"]\]/, "Group roles are finite");
assert.match(rules, /isGroupOwner\(groupId\)/, "owner-only Group mutations use a scoped Group owner helper");
assert.match(rules, /isGroupModerator\(groupId\)/, "moderation stays scoped to Group roles");
assert.match(rules, /groupPublicAfter\(groupId\)/, "public self-join checks the Group visibility/status boundary");
assert.match(rules, /invitedBy/, "private membership requires invitation metadata");
assert.match(rules, /resource\.data\.role\s*!=\s*['"]owner['"]/, "owner membership cannot be self-deleted or demoted through member rules");
assert.match(rules, /request\.resource\.data\.keys\(\)\.hasAny\(\[['"]groupId['"]\]\)/, "canonical communityPosts support Group scoping");
assert.match(rules, /validGroupPinUpdate\(\)/, "canonical Group pin updates have their own scoped validator");

console.log("group Firestore rules contract tests passed");
