import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canManageCommunityBadges,
  normalizeCommunityBadge
} from "../community-badge-policy.mjs";

const adapter = await readFile(new URL("../community-interest-firestore.mjs", import.meta.url), "utf8");
const detail = await readFile(new URL("../community-detail.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

const normalized = normalizeCommunityBadge({
  name: "  Helpful Voice  ",
  description: "  Recognized for constructive Community participation.  ",
  active: true
});
assert.equal(normalized.name, "Helpful Voice");
assert.equal(normalized.description, "Recognized for constructive Community participation.");
assert.equal(normalized.active, true);
assert.equal(normalizeCommunityBadge({ name: "x".repeat(80) }).name.length <= 40, true,
  "Community badge names are bounded");
assert.equal(normalizeCommunityBadge({ description: "x".repeat(300) }).description.length <= 160, true,
  "Community badge descriptions are bounded");
assert.equal(canManageCommunityBadges({ role: "owner" }), true);
assert.equal(canManageCommunityBadges({ role: "moderator" }), true);
assert.equal(canManageCommunityBadges({ role: "member" }), false);

for (const api of [
  "listCommunityBadgeTypes",
  "saveCommunityBadgeType",
  "listCommunityMemberBadges",
  "setCommunityMemberBadge",
  "removeCommunityMemberBadge"
]) assert.match(adapter, new RegExp(`\\b${api}\\b`), `Community adapter exposes ${api}`);

assert.match(adapter, /collection\(db,\s*["']communities["'],\s*communityId,\s*["']badges["']\)/,
  "Community badge definitions are stored under the Community");
assert.match(adapter, /["']communities["'],\s*communityId,\s*["']members["'],\s*uid,\s*["']badges["']/,
  "Community badge assignments are stored under a Community member");
assert.equal(adapter.includes('doc(db, "badgeTypes"'), false,
  "Community badge controls never write global badgeTypes");
assert.equal(adapter.includes('doc(db, "users", uid, "badges"'), false,
  "Community badge controls never write global profile badges");

assert.match(detail, /community-badge-controls/, "Community detail exposes scoped badge management controls");
assert.match(detail, /saveCommunityBadgeType/, "Community detail can create/edit scoped badge labels");
assert.match(detail, /setCommunityMemberBadge/, "Community detail can assign scoped badges");
assert.match(detail, /removeCommunityMemberBadge/, "Community detail can remove scoped badges");
assert.match(detail, /listCommunityMemberBadges/, "Community detail displays member-scoped badges");

assert.match(rules, /match \/communities\/\{communityId\}\/badges\/\{badgeId\}/,
  "Firestore has a scoped Community badge definition block");
assert.match(rules, /match \/communities\/\{communityId\}\/members\/\{userId\}\/badges\/\{badgeId\}/,
  "Firestore has a scoped Community member badge block");
const badgeRules = rules.match(/match \/communities\/\{communityId\}\/badges\/\{badgeId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.match(badgeRules, /isInterestCommunityModerator\(communityId\)/,
  "only Community owner/moderators can manage scoped badge definitions");
const assignmentRules = rules.match(/match \/communities\/\{communityId\}\/members\/\{userId\}\/badges\/\{badgeId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.match(assignmentRules, /isInterestCommunityModerator\(communityId\)/,
  "only Community owner/moderators can assign scoped badges");
assert.equal(assignmentRules.includes("isAdmin()"), false,
  "Community scoped badge assignment does not create a global-admin mutation path");

console.log("Community scoped badge tests passed");
