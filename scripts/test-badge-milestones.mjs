import assert from "node:assert/strict";
import {
  EARLY_MEMBER_CUTOFF,
  FOUNDING_MEMBER_CUTOFF,
  INITIAL_AUTOMATIC_BADGES,
  qualifiesForBadge,
  matchingAutomaticBadges
} from "../badge-milestones.mjs";

assert.equal(typeof FOUNDING_MEMBER_CUTOFF, "number");
assert.equal(typeof EARLY_MEMBER_CUTOFF, "number");
assert.ok(Number.isFinite(FOUNDING_MEMBER_CUTOFF));
assert.ok(Number.isFinite(EARLY_MEMBER_CUTOFF));
assert.ok(EARLY_MEMBER_CUTOFF > FOUNDING_MEMBER_CUTOFF, "Early Member window is broader than Founding Member cohort");

const ids = INITIAL_AUTOMATIC_BADGES.map((badge) => badge.id);
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
]) assert.ok(ids.includes(id), `automatic badge catalog includes ${id}`);

assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"founder", active:true }, { founder:true }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"founding_member", active:true }, { account_created_at_ms:FOUNDING_MEMBER_CUTOFF }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"founding_member", active:true }, { account_created_at_ms:FOUNDING_MEMBER_CUTOFF + 1 }), false);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"early_member", active:true }, { account_created_at_ms:EARLY_MEMBER_CUTOFF }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"early_member", active:true }, { account_created_at_ms:EARLY_MEMBER_CUTOFF + 1 }), false);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"early_supporter", active:true }, { early_supporter:true }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"verified_admin", active:true }, { verified_admin:true }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"verified_moderator", active:true }, { verified_moderator:true }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:100, active:true }, { posts_created:100 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:100, active:true }, { posts_created:99 }), false);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"single_post_interactions", milestoneThreshold:100, active:true }, { single_post_interactions:100 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"comments_or_replies_created", milestoneThreshold:100, active:true }, { comments_or_replies_created:100 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"account_age_days", milestoneThreshold:365, active:true }, { account_age_days:365 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"premium_active", active:true }, { premium_active:true }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"special_achievement", active:true }, { special_achievement:true }), true);
assert.equal(qualifiesForBadge({ awardMode:"manual", milestoneMetric:"posts_created", milestoneThreshold:1, active:true }, { posts_created:100 }), false);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:1, active:false }, { posts_created:100 }), false);

const definitions = [
  { id:"top-contributor", awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:100, active:true },
  { id:"community-helper", awardMode:"automatic", milestoneMetric:"comments_or_replies_created", milestoneThreshold:100, active:true },
  { id:"founder", awardMode:"automatic", milestoneMetric:"founder", active:true }
];
assert.deepEqual(
  matchingAutomaticBadges(definitions, { posts_created:100, comments_or_replies_created:100, founder:true }, ["posts_created"]).map((badge) => badge.id),
  ["top-contributor"]
);

console.log("fixed automatic badge milestone tests passed");
