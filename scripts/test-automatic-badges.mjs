import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [policy, firestore, admin, profileHtml, profileJs, serverAdapter, processor] = await Promise.all([
  read("badge-policy.mjs"),
  read("badge-firestore.mjs"),
  read("admin-badges.js"),
  read("profile.html"),
  read("profile-badges.js"),
  read("badge-award-firestore-adapter.mjs"),
  read("badge-award-processor.mjs")
]);
const profile = `${profileHtml}\n${profileJs}`;

for (const id of [
  "founder",
  "founding-member",
  "early-member",
  "early-supporter",
  "verified-admin",
  "verified-moderator",
  "top-contributor",
  "popular-post-creator",
  "community-helper",
  "long-time-member",
  "premium-member",
  "special-achievement"
]) {
  assert.match(policy, new RegExp(`["']${id}["']`), `fixed AnonChat badge catalog includes ${id}`);
}

assert.doesNotMatch(policy, /BADGE_AWARD_MODES[^\n]*manual|["']manual["']/, "badge policy must not support manual awards");
assert.match(policy, /Spark|spark/, "badge system exposes Spark progression styling");
assert.match(policy, /Pulse|pulse/, "badge system exposes Pulse progression styling");
assert.match(policy, /Beacon|beacon/, "badge system exposes Beacon progression styling");
assert.match(policy, /Legend|legend/, "badge system exposes Legend progression styling");
assert.match(policy, /founder[\s\S]*persistent:\s*true/, "Founder is a permanent trusted-identity badge");
assert.match(policy, /founding-member[\s\S]*persistent:\s*true/, "Founding Member is a permanent launch-cohort badge");
assert.match(policy, /premium-member[\s\S]*premium_active|premium_active[\s\S]*premium-member/, "Premium Member uses Premium entitlement status");
assert.match(policy, /premium-member[\s\S]*persistent:\s*false/, "Premium Member remains a status badge rather than a permanent milestone");

assert.doesNotMatch(firestore, /export const (saveBadgeType|setUserBadge|removeUserBadge|setBadgeFeatured)/, "client Firestore adapter exposes no badge mutation APIs");
assert.match(serverAdapter, /removeStatusBadge/, "trusted server adapter can revoke ordinary inactive Premium badges");
assert.match(serverAdapter, /trustedPremiumEntitlement/, "trusted server adapter protects founder/founding Premium entitlement");
assert.match(processor, /trustedPremiumEntitlement[\s\S]*removeStatusBadge|removeStatusBadge[\s\S]*premium-member/,
  "Premium reconciliation revokes ordinary inactive Premium while preserving trusted founding entitlement");
assert.doesNotMatch(admin, /Save badge|Assign selected badge|Remove badge|Deactivate|Activate|id=["']badge-save["']|id=["']badge-user-assign["']/, "admin badge UI is read-only");
assert.match(admin, /read-only|view/i, "admin badge UI explains that badge data is read-only");

assert.match(profileHtml, /id="profile-badges-open"[^>]*>Badges<\/button>/i,
  "profile badge UI exposes a dedicated Badges action");
assert.doesNotMatch(profileHtml, /profile-badges-view-all|profile-badges-section/,
  "earned badges stay behind the Badges action rather than an inline preview above Spotify");
assert.match(profileJs, /profile-badges-open[\s\S]*addEventListener\(["']click["']|entryButton\?\.addEventListener\(["']click["']/,
  "Badges action is wired to the interactive collection dialog");
assert.match(profile, /earned|earnedAt/i, "profile badge details include earned date information");
assert.match(profile, /image|artwork/i, "profile badge UI renders badge artwork");

console.log("Automatic immutable badge contract passed");
