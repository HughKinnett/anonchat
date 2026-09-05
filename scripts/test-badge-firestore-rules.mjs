import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.match(rules, /match \/badgeTypes\/\{badgeId\}/, "badge definitions have an explicit rules block");
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}/, "user badge assignments have an explicit rules block");
assert.match(rules, /match \/badgeTypes\/\{badgeId\}[\s\S]{0,2400}allow read: if signedIn\(\);[\s\S]{0,2400}isAdmin\(\)/, "badge definitions are readable to signed-in users and mutable only by admins");
assert.match(rules, /function profileBadgesReadable\(userId\)/, "badge privacy uses a focused read policy");
assert.match(rules, /profilePrivacy[\s\S]{0,500}showBadges/, "badge reads honor the profile showBadges preference");
assert.match(rules, /request\.auth\.uid == userId[\s\S]{0,500}isAdmin\(\)/, "owners and admins can still inspect badge assignments");
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}[\s\S]{0,500}allow read: if profileBadgesReadable\(userId\);[\s\S]{0,500}allow (create|write)[^;]*isAdmin\(\)/, "badge assignments are privacy-aware and mutable only by admins");

const badgeTypeBlock = rules.match(/match \/badgeTypes\/\{badgeId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.match(badgeTypeBlock, /keys\(\)\.hasOnly\(\[/, "badge definitions whitelist stored schema keys");
for (const key of ["name", "description", "imageUrl", "category", "awardMode", "milestoneMetric", "milestoneThreshold", "active", "createdAt", "createdBy", "updatedAt"]) {
  assert.match(badgeTypeBlock, new RegExp(`["']${key}["']`), `badge definition schema includes ${key}`);
}
assert.match(badgeTypeBlock, /awardMode[\s\S]{0,300}automatic[\s\S]{0,100}manual/, "badge award mode is limited to automatic or manual");
for (const metric of [
  "posts_created",
  "single_post_interactions",
  "total_interactions_received",
  "comments_received",
  "comments_or_replies_created",
  "followers_count",
  "account_age_days",
  "early_member",
  "premium_active"
]) assert.match(badgeTypeBlock, new RegExp(`["']${metric}["']`), `badge rules allow supported metric ${metric}`);
assert.match(badgeTypeBlock, /milestoneThreshold[\s\S]{0,1000}is int/, "numeric badge thresholds are whole numbers");
assert.match(badgeTypeBlock, /milestoneThreshold[\s\S]{0,1000}> 0/, "numeric badge thresholds are positive");
assert.match(badgeTypeBlock, /early_member[\s\S]{0,1200}premium_active[\s\S]{0,1200}milestoneThreshold[\s\S]{0,300}== null/, "fixed-condition metrics require a null threshold");
assert.match(badgeTypeBlock, /createdAt[\s\S]{0,600}request\.time/, "badge creation timestamps are server-authenticated");
assert.match(badgeTypeBlock, /createdBy[\s\S]{0,600}request\.auth\.uid/, "badge creator identity is server-authenticated");

console.log("badge firestore rules contract tests passed");
