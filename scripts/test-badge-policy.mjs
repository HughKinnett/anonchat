import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BADGE_AWARD_MODES,
  BADGE_MILESTONE_METRICS,
  MAX_FEATURED_BADGES,
  PROFILE_BADGE_PREVIEW_LIMIT,
  normalizeBadgeType,
  normalizeBadgeAssignment,
  sortEarnedBadges,
  previewEarnedBadges,
  canFeatureBadge,
  validBadgeImageUrl
} from "../badge-policy.mjs";

assert.equal(MAX_FEATURED_BADGES, 3);
assert.equal(PROFILE_BADGE_PREVIEW_LIMIT, 4);
assert.deepEqual(BADGE_AWARD_MODES, ["automatic", "manual"]);
assert.ok(BADGE_MILESTONE_METRICS.includes("posts_created"));
assert.ok(BADGE_MILESTONE_METRICS.includes("premium_active"));
assert.equal(validBadgeImageUrl("https://example.com/badge.png"), true);
assert.equal(validBadgeImageUrl("http://example.com/badge.png"), false);
assert.equal(validBadgeImageUrl("javascript:alert(1)"), false);

const badge = normalizeBadgeType({
  name: " Early Supporter ",
  description: " Joined during launch. ",
  imageUrl: "https://example.com/early.png",
  category: "early_supporter",
  awardMode: "automatic",
  milestoneMetric: "posts_created",
  milestoneThreshold: 10,
  active: true
});
assert.equal(badge.name, "Early Supporter");
assert.equal(badge.description, "Joined during launch.");
assert.equal(badge.awardMode, "automatic");
assert.equal(badge.milestoneMetric, "posts_created");
assert.equal(badge.milestoneThreshold, 10);

const manualBadge = normalizeBadgeType({
  name: " Staff ",
  description: " Team member. ",
  awardMode: "manual",
  milestoneMetric: "posts_created",
  milestoneThreshold: 100
});
assert.equal(manualBadge.awardMode, "manual");
assert.equal(manualBadge.milestoneMetric, null);
assert.equal(manualBadge.milestoneThreshold, null);

const premiumBadge = normalizeBadgeType({
  name: " Premium Member ",
  description: " Premium activated. ",
  awardMode: "automatic",
  milestoneMetric: "premium_active",
  milestoneThreshold: 100
});
assert.equal(premiumBadge.milestoneThreshold, null);

const assignment = normalizeBadgeAssignment({ awardSource: "automatic" }, "first-post");
assert.equal(assignment.awardSource, "automatic");

const earned = [
  { badgeId: "old", featured: false, earnedAtMs: 100 },
  { badgeId: "featured-new", featured: true, earnedAtMs: 300 },
  { badgeId: "featured-old", featured: true, earnedAtMs: 200 },
  { badgeId: "new", featured: false, earnedAtMs: 400 },
  { badgeId: "extra", featured: false, earnedAtMs: 50 }
];
assert.deepEqual(sortEarnedBadges(earned).map((x) => x.badgeId), ["featured-new", "featured-old", "new", "old", "extra"]);
assert.equal(previewEarnedBadges(earned).length, 4);
assert.equal(canFeatureBadge(earned, "old"), true);
assert.equal(canFeatureBadge(earned.map((x, i) => ({ ...x, featured: i < 3 })), "extra"), false);

const firestoreSource = await readFile(new URL("../badge-firestore.mjs", import.meta.url), "utf8");
for (const name of ["listBadgeTypes", "listUserBadges", "saveBadgeType", "setUserBadge", "removeUserBadge", "setBadgeFeatured"]) {
  assert.match(firestoreSource, new RegExp(`export const ${name}`));
}
assert.match(firestoreSource, /from "\.\/badge-policy\.mjs"/);
assert.match(firestoreSource, /firebase-firestore\.js/);

console.log("badge policy and firestore adapter contract tests passed");
