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
assert.match(policy, /premium-member[\s\S]*premium_active|premium_active[\s\S]*premium-member/, "Premium Member is tied to active Premium status");
assert.match(policy, /premium-member[\s\S]*persistent:\s*false/, "Premium Member is a revocable status badge");

assert.doesNotMatch(firestore, /export const (saveBadgeType|setUserBadge|removeUserBadge|setBadgeFeatured)/, "client Firestore adapter exposes no badge mutation APIs");
assert.match(serverAdapter, /removeStatusBadge/, "trusted server adapter can revoke status badges");
assert.match(processor, /premium_active[\s\S]*false[\s\S]*removeStatusBadge|removeStatusBadge[\s\S]*premium-member/, "Premium reconciliation removes the badge when paid Premium is inactive");
assert.doesNotMatch(admin, /Save badge|Assign selected badge|Remove badge|Deactivate|Activate|id=["']badge-save["']|id=["']badge-user-assign["']/, "admin badge UI is read-only");
assert.match(admin, /read-only|view/i, "admin badge UI explains that badge data is read-only");

assert.match(profile, /View all badges|view all badges/i, "profile badge UI supports View all badges");
assert.match(profileJs, /profile-badges-view-all[\s\S]*addEventListener\(["']click["']/, "View all badges is wired to an interactive collection action");
assert.match(profile, /earned|earnedAt/i, "profile badge details include earned date information");
assert.match(profile, /image|artwork/i, "profile badge UI renders badge artwork");

console.log("Automatic immutable badge contract passed");
