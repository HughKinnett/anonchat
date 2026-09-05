import assert from "node:assert/strict";
import {
  MAX_FEATURED_BADGES,
  PROFILE_BADGE_PREVIEW_LIMIT,
  normalizeBadgeType,
  sortEarnedBadges,
  previewEarnedBadges,
  canFeatureBadge,
  validBadgeImageUrl
} from "../badge-policy.mjs";

assert.equal(MAX_FEATURED_BADGES, 3);
assert.equal(PROFILE_BADGE_PREVIEW_LIMIT, 4);
assert.equal(validBadgeImageUrl("https://example.com/badge.png"), true);
assert.equal(validBadgeImageUrl("http://example.com/badge.png"), false);
assert.equal(validBadgeImageUrl("javascript:alert(1)"), false);

const badge = normalizeBadgeType({
  name: " Early Supporter ",
  description: " Joined during launch. ",
  imageUrl: "https://example.com/early.png",
  category: "early_supporter",
  active: true
});
assert.equal(badge.name, "Early Supporter");
assert.equal(badge.description, "Joined during launch.");

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

console.log("badge policy tests passed");
