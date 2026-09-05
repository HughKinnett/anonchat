export const EARLY_MEMBER_CUTOFF = Date.parse("2026-09-05T23:59:59.999Z");

const automaticBadge = (id, name, milestoneMetric, milestoneThreshold = null) => Object.freeze({
  id,
  name,
  awardMode: "automatic",
  milestoneMetric,
  milestoneThreshold,
  active: true
});

export const INITIAL_AUTOMATIC_BADGES = Object.freeze([
  automaticBadge("first-post", "First Post", "posts_created", 1),
  automaticBadge("contributor", "Contributor", "posts_created", 10),
  automaticBadge("top-contributor", "Top Contributor", "posts_created", 100),
  automaticBadge("community-favorite", "Community Favorite", "single_post_interactions", 25),
  automaticBadge("popular-creator", "Popular Creator", "total_interactions_received", 100),
  automaticBadge("conversation-starter", "Conversation Starter", "comments_received", 25),
  automaticBadge("community-helper", "Community Helper", "comments_or_replies_created", 50),
  automaticBadge("connected", "Connected", "followers_count", 25),
  automaticBadge("well-known", "Well Known", "followers_count", 100),
  automaticBadge("long-time-member", "Long-Time Member", "account_age_days", 365),
  automaticBadge("early-member", "Early Member", "early_member"),
  automaticBadge("premium-member", "Premium Member", "premium_active")
]);

const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);

export const qualifiesForBadge = (definition = {}, metrics = {}) => {
  if (definition.active === false || definition.awardMode !== "automatic") return false;

  const metric = definition.milestoneMetric;
  if (metric === "premium_active") return metrics.premium_active === true;
  if (metric === "early_member") {
    return finiteNumber(metrics.account_created_at_ms) && metrics.account_created_at_ms <= EARLY_MEMBER_CUTOFF;
  }

  const threshold = Number(definition.milestoneThreshold);
  const value = Number(metrics[metric]);
  return Number.isFinite(threshold) && threshold > 0 && Number.isFinite(value) && value >= threshold;
};

export const matchingAutomaticBadges = (definitions = [], metrics = {}, changedMetrics = []) => {
  const changed = new Set(Array.isArray(changedMetrics) ? changedMetrics : []);
  return definitions.filter((definition) =>
    definition?.awardMode === "automatic" &&
    definition?.active !== false &&
    changed.has(definition.milestoneMetric) &&
    qualifiesForBadge(definition, metrics)
  );
};
