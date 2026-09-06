import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ANONCHAT_BADGE_CATALOG,
  BADGE_MILESTONE_METRICS,
  MAX_FEATURED_BADGES,
  PROFILE_BADGE_PREVIEW_LIMIT,
  normalizeBadgeAssignment,
  sortEarnedBadges,
  previewEarnedBadges,
  canFeatureBadge,
  eligibleAutomaticBadgeIds,
  badgeShouldRemainVisible
} from "../badge-policy.mjs";

assert.equal(MAX_FEATURED_BADGES, 3);
assert.equal(PROFILE_BADGE_PREVIEW_LIMIT, 4);
assert.equal(ANONCHAT_BADGE_CATALOG.length, 12, "fixed catalog contains the approved 12 AnonChat badges");
for (const id of [
  "founder", "founding-member", "early-member", "early-supporter",
  "verified-admin", "verified-moderator", "top-contributor",
  "popular-post-creator", "community-helper", "long-time-member",
  "premium-member", "special-achievement"
]) assert.ok(ANONCHAT_BADGE_CATALOG.some((badge) => badge.id === id), `catalog includes ${id}`);
for (const metric of ["founder", "founding_member", "posts_created", "premium_active", "account_age_days"]) {
  assert.ok(BADGE_MILESTONE_METRICS.includes(metric), `badge metrics include ${metric}`);
}
for (const badge of ANONCHAT_BADGE_CATALOG) {
  assert.match(badge.imageUrl, /^badges\/[a-z0-9-]+[.]svg$/, `${badge.id} uses a bundled AnonChat badge asset`);
  await readFile(new URL(`../${badge.imageUrl}`, import.meta.url), "utf8");
}

const assignment = normalizeBadgeAssignment({ awardSource: "manual", featured: true }, "founder");
assert.equal(assignment.awardSource, "automatic", "client normalization cannot preserve a manual award source");
assert.equal(assignment.featured, true);

assert.ok(eligibleAutomaticBadgeIds({ founder: true }).includes("founder"));
assert.ok(eligibleAutomaticBadgeIds({ foundingMember: true }).includes("founding-member"));
assert.ok(eligibleAutomaticBadgeIds({ postsCreated: 100 }).includes("top-contributor"));
assert.ok(eligibleAutomaticBadgeIds({ maxPostInteractions: 100 }).includes("popular-post-creator"));
assert.ok(eligibleAutomaticBadgeIds({ commentsOrRepliesCreated: 100 }).includes("community-helper"));
assert.ok(eligibleAutomaticBadgeIds({ premiumActive: true }).includes("premium-member"));
assert.equal(badgeShouldRemainVisible("premium-member", { premiumActive: false }), false);
assert.equal(badgeShouldRemainVisible("premium-member", { premiumActive: true }), true);
assert.equal(badgeShouldRemainVisible("founder", { premiumActive: false }), true);

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
for (const name of ["listBadgeTypes", "listUserBadges"]) assert.match(firestoreSource, new RegExp(`export const ${name}`));
for (const name of ["saveBadgeType", "setUserBadge", "removeUserBadge", "setBadgeFeatured"]) {
  assert.doesNotMatch(firestoreSource, new RegExp(`export const ${name}`), `${name} is not exposed to clients`);
}
assert.match(firestoreSource, /ANONCHAT_BADGE_CATALOG/);
assert.match(firestoreSource, /firebase-firestore\.js/);

console.log("fixed badge policy and read-only Firestore adapter contract tests passed");
