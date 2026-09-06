export const BADGE_TIERS = Object.freeze([
  "Spark",
  "Pulse",
  "Beacon",
  "Legend"
]);

export const BADGE_MILESTONE_METRICS = Object.freeze([
  "founder",
  "founding_member",
  "posts_created",
  "single_post_interactions",
  "total_interactions_received",
  "comments_or_replies_created",
  "followers_count",
  "account_age_days",
  "early_member",
  "early_supporter",
  "verified_admin",
  "verified_moderator",
  "premium_active",
  "special_achievement"
]);

export const MAX_FEATURED_BADGES = 3;
export const PROFILE_BADGE_PREVIEW_LIMIT = 4;

export const ANONCHAT_BADGE_CATALOG = Object.freeze([
  Object.freeze({
    id: "founder",
    name: "Founder",
    description: "Identifies an original founder of AnonChat.",
    imageUrl: "badges/founder.svg",
    category: "founder",
    milestoneMetric: "founder",
    milestoneThreshold: null,
    tier: "Legend",
    persistent: true
  }),
  Object.freeze({
    id: "founding-member",
    name: "Founding Member",
    description: "Was already part of AnonChat during its founding launch cohort.",
    imageUrl: "badges/founding-member.svg",
    category: "founding_member",
    milestoneMetric: "founding_member",
    milestoneThreshold: null,
    tier: "Beacon",
    persistent: true
  }),
  Object.freeze({
    id: "early-member",
    name: "Early Member",
    description: "Joined AnonChat during its early launch era.",
    imageUrl: "badges/early-member.svg",
    category: "early_member",
    milestoneMetric: "early_member",
    milestoneThreshold: null,
    tier: "Spark",
    persistent: true
  }),
  Object.freeze({
    id: "early-supporter",
    name: "Early Supporter",
    description: "Supported AnonChat during its early launch period.",
    imageUrl: "badges/early-supporter.svg",
    category: "early_supporter",
    milestoneMetric: "early_supporter",
    milestoneThreshold: null,
    tier: "Pulse",
    persistent: true
  }),
  Object.freeze({
    id: "verified-admin",
    name: "Verified Admin",
    description: "Recognized by AnonChat as a verified administrator.",
    imageUrl: "badges/verified-admin.svg",
    category: "staff",
    milestoneMetric: "verified_admin",
    milestoneThreshold: null,
    tier: "Beacon",
    persistent: true
  }),
  Object.freeze({
    id: "verified-moderator",
    name: "Verified Moderator",
    description: "Recognized by AnonChat as a verified moderator.",
    imageUrl: "badges/verified-moderator.svg",
    category: "staff",
    milestoneMetric: "verified_moderator",
    milestoneThreshold: null,
    tier: "Beacon",
    persistent: true
  }),
  Object.freeze({
    id: "top-contributor",
    name: "Top Contributor",
    description: "Reached a sustained contribution milestone through posts and replies.",
    imageUrl: "badges/top-contributor.svg",
    category: "contributor",
    milestoneMetric: "posts_created",
    milestoneThreshold: 100,
    tier: "Legend",
    persistent: true
  }),
  Object.freeze({
    id: "popular-post-creator",
    name: "Popular Post Creator",
    description: "Created a post that reached a major interaction milestone.",
    imageUrl: "badges/popular-post-creator.svg",
    category: "popular_post",
    milestoneMetric: "single_post_interactions",
    milestoneThreshold: 100,
    tier: "Beacon",
    persistent: true
  }),
  Object.freeze({
    id: "community-helper",
    name: "Community Helper",
    description: "Consistently helped the wider AnonChat community through constructive participation.",
    imageUrl: "badges/community-helper.svg",
    category: "community_helper",
    milestoneMetric: "comments_or_replies_created",
    milestoneThreshold: 100,
    tier: "Pulse",
    persistent: true
  }),
  Object.freeze({
    id: "long-time-member",
    name: "Long-Time Member",
    description: "Reached a long-term AnonChat membership anniversary.",
    imageUrl: "badges/long-time-member.svg",
    category: "long_time_member",
    milestoneMetric: "account_age_days",
    milestoneThreshold: 365,
    tier: "Beacon",
    persistent: true
  }),
  Object.freeze({
    id: "premium-member",
    name: "Premium Member",
    description: "Currently has an active paid AnonChat Premium membership.",
    imageUrl: "badges/premium-member.svg",
    category: "premium",
    milestoneMetric: "premium_active",
    milestoneThreshold: null,
    tier: "Legend",
    persistent: false
  }),
  Object.freeze({
    id: "special-achievement",
    name: "Special Achievement",
    description: "Earned through a predefined AnonChat event or special milestone.",
    imageUrl: "badges/special-achievement.svg",
    category: "special",
    milestoneMetric: "special_achievement",
    milestoneThreshold: null,
    tier: "Legend",
    persistent: true
  })
]);

export const badgeDefinition = (badgeId) =>
  ANONCHAT_BADGE_CATALOG.find((badge) => badge.id === badgeId) || null;

export const normalizeBadgeAssignment = (raw = {}, badgeId = "") => ({
  badgeId: String(raw.badgeId || badgeId),
  featured: raw.featured === true,
  earnedAt: raw.earnedAt ?? null,
  awardSource: "automatic"
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

export const eligibleAutomaticBadgeIds = ({
  founder = false,
  foundingMember = false,
  postsCreated = 0,
  maxPostInteractions = 0,
  commentsOrRepliesCreated = 0,
  accountAgeDays = 0,
  earlyMember = false,
  earlySupporter = false,
  verifiedAdmin = false,
  verifiedModerator = false,
  premiumActive = false,
  specialAchievement = false
} = {}) => ANONCHAT_BADGE_CATALOG.filter((badge) => {
  switch (badge.milestoneMetric) {
    case "founder": return founder;
    case "founding_member": return foundingMember;
    case "early_member": return earlyMember;
    case "early_supporter": return earlySupporter;
    case "verified_admin": return verifiedAdmin;
    case "verified_moderator": return verifiedModerator;
    case "posts_created": return postsCreated >= badge.milestoneThreshold;
    case "single_post_interactions": return maxPostInteractions >= badge.milestoneThreshold;
    case "comments_or_replies_created": return commentsOrRepliesCreated >= badge.milestoneThreshold;
    case "account_age_days": return accountAgeDays >= badge.milestoneThreshold;
    case "premium_active": return premiumActive;
    case "special_achievement": return specialAchievement;
    default: return false;
  }
}).map((badge) => badge.id);

export const badgeShouldRemainVisible = (badgeId, { premiumActive = false } = {}) => {
  const badge = badgeDefinition(badgeId);
  if (!badge) return false;
  if (badgeId === "premium-member") return premiumActive;
  return true;
};
