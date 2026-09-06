import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, badgeAdmin, badgePolicy, badgeFirestore] = await Promise.all([
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../admin-badges.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-policy.mjs", import.meta.url), "utf8"),
  readFile(new URL("../badge-firestore.mjs", import.meta.url), "utf8")
]);

const surface = `${html}\n${badgeAdmin}`;
for (const id of ["badge-admin-section", "badge-definition-list"]) {
  assert.match(surface, new RegExp(`id=["']${id}["']|id\\s*=\\s*["']${id}["']`), `read-only admin badge catalog includes #${id}`);
}

for (const id of [
  "badge-user-id",
  "badge-user-refresh",
  "badge-user-assignments",
  "badge-name",
  "badge-description",
  "badge-image-url",
  "badge-category",
  "badge-active",
  "badge-award-mode",
  "badge-milestone-metric",
  "badge-milestone-threshold",
  "badge-save",
  "badge-user-select",
  "badge-user-assign"
]) assert.doesNotMatch(surface, new RegExp(`id=["']${id}["']|id\\s*=\\s*["']${id}["']`), `admin badge surface does not expose #${id}`);

assert.match(html, /admin-badges\.js/, "admin page loads read-only badge catalog controller");
assert.match(badgeAdmin, /read-only/i, "admin badge surface tells admins badge data is read-only");
assert.match(badgeAdmin, /listBadgeTypes/, "admin can view the fixed badge catalog");
assert.match(badgeAdmin, /imageUrl/, "admin can see badge artwork");
assert.doesNotMatch(surface, /Member badge status|View member badges|Enter a user ID/i,
  "admin badge panel has no member-specific badge lookup copy");
assert.doesNotMatch(badgeAdmin, /listUserBadges|renderUserAssignments|refreshUserBadges|earnedAt/,
  "admin badge controller has no member-badge lookup code");
assert.match(badgePolicy, /founder/, "fixed badge policy includes Founder");
assert.match(badgePolicy, /founding-member/, "fixed badge policy includes Founding Member");
assert.match(badgePolicy, /premium_active/, "fixed badge policy includes active paid Premium status");

for (const mutation of ["saveBadgeType", "setUserBadge", "removeUserBadge", "setBadgeFeatured"]) {
  assert.doesNotMatch(badgeAdmin, new RegExp(mutation), `admin controller cannot call ${mutation}`);
  assert.doesNotMatch(badgeFirestore, new RegExp(`export const ${mutation}`), `client adapter does not export ${mutation}`);
}
assert.doesNotMatch(badgeAdmin, /Assign selected badge|Remove badge|Deactivate|Activate|Save badge/i,
  "admin badge surface exposes no badge mutation actions");

console.log("read-only admin badge catalog tests passed");
