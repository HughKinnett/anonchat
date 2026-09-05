import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, badgeAdmin, badgePolicy] = await Promise.all([
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../admin-badges.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-policy.mjs", import.meta.url), "utf8")
]);

const surface = `${html}\n${badgeAdmin}`;
for (const id of [
  "badge-admin-section",
  "badge-name",
  "badge-description",
  "badge-image-url",
  "badge-category",
  "badge-active",
  "badge-award-mode",
  "badge-milestone-metric",
  "badge-milestone-threshold",
  "badge-save",
  "badge-definition-list",
  "badge-user-id",
  "badge-user-select",
  "badge-user-refresh",
  "badge-user-assignments"
]) assert.match(surface, new RegExp(`id=["']${id}["']|id\\s*=\\s*["']${id}["']`), `admin badge surface includes #${id}`);

assert.match(html, /admin-badges\.js/, "admin page loads badge management controller");
assert.match(badgeAdmin, /BADGE_MILESTONE_METRICS/, "admin metric selector is populated from the shared milestone policy");
assert.match(badgeAdmin, /automatic/i, "admin can choose automatic award mode");
assert.match(badgeAdmin, /manual/i, "admin can choose manual award mode");
assert.match(badgePolicy, /posts_created/, "shared badge policy includes posts_created");
assert.match(badgePolicy, /account_age_days/, "shared badge policy includes account_age_days");
assert.match(badgePolicy, /premium_active/, "shared badge policy includes premium_active");
assert.match(badgeAdmin, /saveBadgeType/, "badge admin controller persists badge definitions");
assert.match(badgeAdmin, /setUserBadge/, "badge admin controller can assign badges manually");
assert.match(badgeAdmin, /removeUserBadge/, "badge admin controller can remove user badges");
assert.match(badgeAdmin, /setBadgeFeatured/, "badge admin controller can feature earned badges");
assert.match(badgeAdmin, /listUserBadges/, "badge admin controller lists a selected user's earned badges");
assert.match(badgeAdmin, /milestoneMetric/, "badge admin controller handles milestone metric configuration");
assert.match(badgeAdmin, /milestoneThreshold/, "badge admin controller handles milestone thresholds");
assert.match(badgeAdmin, /awardMode/, "badge admin controller handles automatic versus manual mode");
assert.match(badgeAdmin, /active/, "badge admin controller can activate or deactivate definitions");
assert.match(badgeAdmin, /edit/i, "badge admin controller exposes edit behavior");
assert.match(badgeAdmin, /featured/i, "badge admin controller exposes featured badge controls");

console.log("admin badge surface tests passed");
