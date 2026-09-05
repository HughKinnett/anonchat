import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [awardSource, firestoreSource, processorSource, adapterSource, routingSource] = await Promise.all([
  readFile(new URL("../badge-awards.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-firestore.mjs", import.meta.url), "utf8"),
  readFile(new URL("../badge-award-processor.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-award-firestore-adapter.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-activity-routing.mjs", import.meta.url), "utf8").catch(() => "")
]);

assert.match(awardSource, /evaluateBadgeMilestones/, "automatic badge award service exports evaluateBadgeMilestones");
assert.match(awardSource, /matchingAutomaticBadges/, "award service qualifies definitions through the milestone evaluator");
assert.doesNotMatch(awardSource, /setDoc\s*\(/, "browser award helper never writes badge assignments directly");
assert.doesNotMatch(awardSource, /users["']\s*,\s*uid\s*,\s*["']badges["']/, "browser award helper never targets the protected assignment path");

assert.match(processorSource, /processBadgeAwards/, "trusted badge processor exports processBadgeAwards");
assert.match(processorSource, /matchingAutomaticBadges/, "trusted processor uses the milestone evaluator");
assert.match(processorSource, /already-earned/, "trusted processor preserves existing badge assignments");
assert.match(processorSource, /changedMetrics/, "trusted processor evaluates only changed metrics");
assert.match(processorSource, /CANONICAL_BADGE_SOURCES/, "trusted processor declares canonical activity sources");
assert.match(processorSource, /posts/, "trusted processor observes committed posts");
assert.match(processorSource, /comments/, "trusted processor observes committed comments");
assert.match(processorSource, /reactions/, "trusted processor observes committed reactions");
assert.match(processorSource, /follows/, "trusted processor observes committed follow changes");
assert.match(processorSource, /premiumAccess/, "trusted processor observes committed premium state");
assert.match(processorSource, /users/, "trusted processor observes committed profile state");
assert.match(processorSource, /badgeMetricsForActivity/, "canonical activity is routed through the shared metric mapping");
assert.match(processorSource, /processCanonicalBadgeActivity/, "trusted processor exposes canonical source processing");
assert.match(processorSource, /metricsForCanonicalSource/, "trusted processor derives metrics from canonical stored data instead of client claims");

assert.match(adapterSource, /users.*badges|badges.*users/s, "trusted Firestore adapter owns user badge assignment writes");
assert.match(adapterSource, /runTransaction/, "trusted adapter performs idempotent badge assignment writes transactionally");
assert.match(adapterSource, /badgeTypes/, "trusted adapter reads badge definitions");
assert.match(adapterSource, /assignedBy\s*:\s*["']system["']/, "trusted adapter records system as the assigning actor");
assert.match(adapterSource, /awardSource\s*:\s*["']automatic["']/, "trusted adapter records automatic award source");

assert.match(routingSource, /posts_created/, "post creation routes to posts_created");
assert.match(routingSource, /single_post_interactions/, "post interaction routes to single_post_interactions");
assert.match(routingSource, /total_interactions_received/, "post interaction routes to total_interactions_received");
assert.match(routingSource, /comments_received/, "comment receipt routes to comments_received");
assert.match(routingSource, /comments_or_replies_created/, "comment or reply creation routes to comments_or_replies_created");
assert.match(routingSource, /followers_count/, "follow changes route to followers_count");
assert.match(routingSource, /premium_active/, "premium reconciliation routes to premium_active");
assert.match(routingSource, /early_member/, "profile initialization routes to early_member");
assert.match(routingSource, /account_age_days/, "profile initialization routes to account_age_days");

assert.match(firestoreSource, /awardSource/, "badge Firestore helper preserves assignment source metadata");

console.log("badge award contract tests passed");
