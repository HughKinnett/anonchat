export const BADGE_CATEGORIES = Object.freeze([
  "early_supporter",
  "staff",
  "contributor",
  "popular_post",
  "community_helper",
  "long_time_member",
  "premium",
  "event",
  "milestone",
  "special"
]);

export const BADGE_AWARD_MODES = Object.freeze(["automatic", "manual"]);
export const BADGE_MILESTONE_METRICS = Object.freeze([
  "posts_created",
  "single_post_interactions",
  "total_interactions_received",
  "comments_received",
  "comments_or_replies_created",
  "followers_count",
  "account_age_days",
  "early_member",
  "premium_active"
]);

export const MAX_FEATURED_BADGES = 3;
export const PROFILE_BADGE_PREVIEW_LIMIT = 4;

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const FIXED_CONDITION_METRICS = new Set(["early_member", "premium_active"]);

export const validBadgeImageUrl = (value) => {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
};

export const normalizeBadgeType = (raw = {}) => {
  const awardMode = BADGE_AWARD_MODES.includes(raw.awardMode) ? raw.awardMode : "manual";
  const milestoneMetric = awardMode === "automatic" && BADGE_MILESTONE_METRICS.includes(raw.milestoneMetric)
    ? raw.milestoneMetric
    : null;
  const threshold = Number(raw.milestoneThreshold);
  const milestoneThreshold = awardMode === "automatic" && milestoneMetric && !FIXED_CONDITION_METRICS.has(milestoneMetric) && Number.isFinite(threshold) && threshold > 0
    ? threshold
    : null;

  return {
    name: text(raw.name, 60),
    description: text(raw.description, 280),
    imageUrl: validBadgeImageUrl(raw.imageUrl) ? String(raw.imageUrl) : "",
    category: BADGE_CATEGORIES.includes(raw.category) ? raw.category : "special",
    awardMode,
    milestoneMetric,
    milestoneThreshold,
    active: raw.active !== false
  };
};

export const normalizeBadgeAssignment = (raw = {}, badgeId = "") => ({
  badgeId: String(raw.badgeId || badgeId),
  featured: raw.featured === true,
  earnedAt: raw.earnedAt ?? null,
  assignedAt: raw.assignedAt ?? null,
  assignedBy: String(raw.assignedBy || ""),
  awardSource: BADGE_AWARD_MODES.includes(raw.awardSource) ? raw.awardSource : "manual"
});

const millis = (entry) => Number(entry.earnedAtMs ?? entry.earnedAt?.toMillis?.() ?? 0);

export const sortEarnedBadges = (entries = []) => [...entries].sort((a, b) =>
  Number(b.featured) - Number(a.featured) || millis(b) - millis(a)
);

export const previewEarnedBadges = (entries = []) =>
  sortEarnedBadges(entries).slice(0, PROFILE_BADGE_PREVIEW_LIMIT);

export const canFeatureBadge = (assignments = [], badgeId) => {
  const target = assignments.find((entry) => entry.badgeId === badgeId);
  if (target?.featured) return true;
  return assignments.filter((entry) => entry.featured).length < MAX_FEATURED_BADGES;
};
