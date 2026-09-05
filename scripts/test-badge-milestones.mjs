import assert from "node:assert/strict";
import {
  EARLY_MEMBER_CUTOFF,
  INITIAL_AUTOMATIC_BADGES,
  qualifiesForBadge,
  matchingAutomaticBadges
} from "../badge-milestones.mjs";

assert.equal(typeof EARLY_MEMBER_CUTOFF, "number");
assert.ok(Number.isFinite(EARLY_MEMBER_CUTOFF));

const names = INITIAL_AUTOMATIC_BADGES.map((badge) => badge.name);
for (const name of [
  "First Post",
  "Contributor",
  "Top Contributor",
  "Community Favorite",
  "Popular Creator",
  "Conversation Starter",
  "Community Helper",
  "Connected",
  "Well Known",
  "Long-Time Member",
  "Early Member",
  "Premium Member"
]) assert.ok(names.includes(name), `initial automatic badges include ${name}`);

assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:1, active:true }, { posts_created:1 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:10, active:true }, { posts_created:9 }), false);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"single_post_interactions", milestoneThreshold:25, active:true }, { single_post_interactions:25 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"total_interactions_received", milestoneThreshold:100, active:true }, { total_interactions_received:100 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"comments_received", milestoneThreshold:25, active:true }, { comments_received:25 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"comments_or_replies_created", milestoneThreshold:50, active:true }, { comments_or_replies_created:50 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"followers_count", milestoneThreshold:100, active:true }, { followers_count:100 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"account_age_days", milestoneThreshold:365, active:true }, { account_age_days:365 }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"premium_active", active:true }, { premium_active:true }), true);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"early_member", active:true }, { account_created_at_ms:EARLY_MEMBER_CUTOFF }), true);
assert.equal(qualifiesForBadge({ awardMode:"manual", milestoneMetric:"posts_created", milestoneThreshold:1, active:true }, { posts_created:100 }), false);
assert.equal(qualifiesForBadge({ awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:1, active:false }, { posts_created:100 }), false);

const definitions = [
  { id:"first-post", awardMode:"automatic", milestoneMetric:"posts_created", milestoneThreshold:1, active:true },
  { id:"connected", awardMode:"automatic", milestoneMetric:"followers_count", milestoneThreshold:25, active:true },
  { id:"manual", awardMode:"manual", milestoneMetric:"posts_created", milestoneThreshold:1, active:true }
];
assert.deepEqual(
  matchingAutomaticBadges(definitions, { posts_created:1, followers_count:25 }, ["posts_created"]).map((badge) => badge.id),
  ["first-post"]
);

console.log("badge milestone tests passed");
