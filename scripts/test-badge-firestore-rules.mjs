import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.match(rules, /match \/badgeTypes\/\{badgeId\}/, "badge definitions have an explicit rules block");
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}/, "user badge assignments have an explicit rules block");
assert.match(rules, /match \/badgeTypes\/\{badgeId\}[\s\S]{0,1200}allow read: if signedIn\(\);[\s\S]{0,1200}allow (create|write)[^;]*isAdmin\(\)/, "badge definitions are readable to signed-in users and mutable only by admins");
assert.match(rules, /match \/users\/\{userId\}\/badges\/\{badgeId\}[\s\S]{0,800}allow read: if signedIn\(\);[\s\S]{0,800}allow (create|write)[^;]*isAdmin\(\)/, "badge assignments are readable to signed-in users and mutable only by admins");

const badgeTypeBlock = rules.match(/match \/badgeTypes\/\{badgeId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.match(badgeTypeBlock, /keys\(\)\.hasOnly\(\[/, "badge definitions whitelist stored schema keys");
for (const key of ["name", "description", "imageUrl", "category", "awardMode", "milestoneMetric", "milestoneThreshold", "active", "createdAt", "createdBy", "updatedAt", "updatedBy"]) {
  assert.match(badgeTypeBlock, new RegExp(`["']${key}["']`), `badge definition schema includes ${key}`);
}
assert.match(badgeTypeBlock, /awardMode[\s\S]{0,240}in \[['"]automatic['"], ['"]manual['"]\]/, "badge award mode is limited to automatic or manual");
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
assert.match(badgeTypeBlock, /milestoneThreshold[\s\S]{0,500}is int/, "numeric badge thresholds are whole numbers");
assert.match(badgeTypeBlock, /milestoneThreshold[\s\S]{0,500}> 0/, "numeric badge thresholds are positive");
assert.match(badgeTypeBlock, /early_member[\s\S]{0,500}premium_active[\s\S]{0,500}milestoneThreshold[\s\S]{0,240}== null/, "fixed-condition metrics require a null threshold");

assert.match(rules, /bio/, "user profile rules account for bio");
assert.match(rules, /bio[^\n]{0,240}300|300[^\n]{0,240}bio/, "bio is limited to 300 characters");
assert.match(rules, /affectedKeys\(\)[\s\S]{0,300}bio/, "bio changes are constrained by the existing affected-keys profile update protections");
assert.match(rules, /hasOnly\(\['bio'\]\)[\s\S]{0,240}request\.resource\.data\.get\('bio', ''\) is string/, "bio updates remain owner-scoped and string validated");

console.log("badge firestore rules contract tests passed");
