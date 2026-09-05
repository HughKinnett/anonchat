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

export const MAX_FEATURED_BADGES = 3;
export const PROFILE_BADGE_PREVIEW_LIMIT = 4;

const text = (value, max) => String(value ?? "").trim().slice(0, max);

export const validBadgeImageUrl = (value) => {
  try {
    return new URL(String(value)).protocol === "https:";
  } catch {
    return false;
  }
};

export const normalizeBadgeType = (raw = {}) => ({
  name: text(raw.name, 60),
  description: text(raw.description, 280),
  imageUrl: validBadgeImageUrl(raw.imageUrl) ? String(raw.imageUrl) : "",
  category: BADGE_CATEGORIES.includes(raw.category) ? raw.category : "special",
  active: raw.active !== false
});

export const normalizeBadgeAssignment = (raw = {}, badgeId = "") => ({
  badgeId: String(raw.badgeId || badgeId),
  featured: raw.featured === true,
  earnedAt: raw.earnedAt ?? null,
  assignedAt: raw.assignedAt ?? null,
  assignedBy: String(raw.assignedBy || "")
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
