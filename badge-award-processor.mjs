import { matchingAutomaticBadges } from "./badge-milestones.mjs";
import { badgeMetricsForActivity } from "./badge-activity-routing.mjs";

export const CANONICAL_BADGE_SOURCES = Object.freeze({
  posts: Object.freeze(["post_created"]),
  comments: Object.freeze(["comment_or_reply_created", "comment_received"]),
  reactions: Object.freeze(["post_interaction_received"]),
  follows: Object.freeze(["followers_changed"]),
  premiumAccess: Object.freeze(["premium_reconciled"]),
  users: Object.freeze(["profile_initialized"])
});

export const processBadgeAwards = async ({ adapter, uid, changedMetrics = [], metrics = {} }) => {
  if (!adapter || !uid) throw new Error("Badge award adapter and user are required.");
  if (typeof adapter.featureEnabled === "function"
    && await adapter.featureEnabled("badgeAwardsEnabled", true) === false) return [];
  const definitions = await adapter.listActiveDefinitions();
  const matches = matchingAutomaticBadges(definitions, metrics, changedMetrics);
  const results = [];
  for (const badge of matches) {
    const result = await adapter.awardIfMissing(uid, badge.id);
    results.push(result?.reason === "already-earned"
      ? { awarded: false, badgeId: badge.id, reason: "already-earned" }
      : { ...result, badgeId: badge.id });
  }
  return results;
};

export const processCanonicalBadgeActivity = async ({ adapter, source }) => {
  if (!adapter || !source) throw new Error("Badge award adapter and canonical source are required.");
  const collection = String(source.collection || "");
  const activities = CANONICAL_BADGE_SOURCES[collection];
  if (!activities) return [];

  const routed = await adapter.metricsForCanonicalSource(source, activities);
  const work = Array.isArray(routed) ? routed : [];
  const results = [];
  for (const item of work) {
    if (!item?.uid || !activities.includes(item.activity)) continue;
    const changedMetrics = badgeMetricsForActivity(item.activity);
    if (!changedMetrics.length) continue;
    results.push(...await processBadgeAwards({
      adapter,
      uid: item.uid,
      changedMetrics,
      metrics: item.metrics || {}
    }));
  }
  return results;
};
