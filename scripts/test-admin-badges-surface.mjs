import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, js, badgeAdmin] = await Promise.all([
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../admin.js", import.meta.url), "utf8"),
  readFile(new URL("../admin-badges.js", import.meta.url), "utf8").catch(() => "")
]);

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
  "badge-definition-list"
]) assert.match(html, new RegExp(`id=["']${id}["']`), `admin badge surface includes #${id}`);

assert.match(html, /automatic/i, "admin can choose automatic award mode");
assert.match(html, /manual/i, "admin can choose manual award mode");
assert.match(html, /posts_created/, "admin metric selector includes supported milestone metrics");
assert.match(html, /account_age_days/, "admin metric selector includes account age metric");
assert.match(html, /premium_active/, "admin metric selector includes premium metric");

assert.match(js, /admin-badges\.js/, "admin bootstrap wires badge management controller");
assert.match(badgeAdmin, /saveBadgeType/, "badge admin controller persists badge definitions");
assert.match(badgeAdmin, /milestoneMetric/, "badge admin controller handles milestone metric configuration");
assert.match(badgeAdmin, /milestoneThreshold/, "badge admin controller handles milestone thresholds");
assert.match(badgeAdmin, /awardMode/, "badge admin controller handles automatic versus manual mode");
assert.match(badgeAdmin, /active/, "badge admin controller can activate or deactivate definitions");
assert.match(badgeAdmin, /edit/i, "badge admin controller exposes edit behavior");

console.log("admin badge surface tests passed");
