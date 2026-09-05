import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.match(rules, /match \/communities\/\{communityId\}/, "interest Communities have an explicit rules block");
assert.match(rules, /match \/communities\/\{communityId\}\/members\/\{userId\}/, "Community membership has an explicit rules block");

const communityBlock = rules.match(/match \/communities\/\{communityId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.match(communityBlock, /keys\(\)\.hasOnly\(\[/, "Community documents whitelist stored fields");
for (const key of ["name", "slug", "description", "topic", "rules", "ownerId", "visibility", "status", "memberCount", "createdAt", "updatedAt"]) {
  assert.match(communityBlock, new RegExp(`["']${key}["']`), `Community schema includes ${key}`);
}
assert.match(communityBlock, /visibility\s*==\s*["']public["']/, "this phase only accepts public Communities");
assert.match(communityBlock, /ownerId\s*==\s*request\.auth\.uid/, "Community owner identity is authenticated");
assert.match(communityBlock, /rules[\s\S]{0,400}size\(\)\s*<=\s*10/, "Community rule count is bounded");
assert.match(communityBlock, /createdAt\s*==\s*request\.time/, "Community creation timestamp is server-authenticated");
assert.match(communityBlock, /updatedAt\s*==\s*request\.time/, "Community update timestamp is server-authenticated");

const memberBlock = rules.match(/match \/communities\/\{communityId\}\/members\/\{userId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.match(memberBlock, /role[\s\S]{0,250}owner[\s\S]{0,120}moderator[\s\S]{0,120}member/, "membership roles are finite");
assert.match(memberBlock, /userId\s*==\s*request\.auth\.uid/, "normal join/leave is self-scoped");
assert.match(memberBlock, /joinedAt\s*==\s*request\.time/, "join timestamp is authenticated");
assert.match(memberBlock, /request\.resource\.data\.role\s*==\s*["']member["']/, "normal users can only self-join as members");
assert.match(memberBlock, /isInterestCommunityOwner\(communityId\)/, "moderator role changes are owner-gated");
assert.match(memberBlock, /resource\.data\.role\s*!=\s*["']owner["']/, "owner membership cannot be removed or demoted through member controls");

assert.match(rules, /function isInterestCommunityModerator\(communityId\)/, "rules define scoped Community moderator authorization");
assert.match(rules, /function validInterestCommunityPinUpdate\(\)/, "rules define canonical Community pin updates");
assert.match(rules, /match \/communityPosts\/\{postId\}[\s\S]{0,2400}validInterestCommunityPinUpdate\(\)/, "canonical communityPosts allow only scoped moderator pin updates in addition to existing moderation paths");
assert.match(rules, /communityId/, "canonical communityPosts support interest Community scoping");

console.log("community interest Firestore rules contract tests passed");
