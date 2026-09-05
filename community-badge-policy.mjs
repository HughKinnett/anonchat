export const COMMUNITY_BADGE_NAME_MAX = 40;
export const COMMUNITY_BADGE_DESCRIPTION_MAX = 160;

const boundedText = (value, maximum) => String(value || "").trim().slice(0, maximum);

export const normalizeCommunityBadge = (input = {}) => Object.freeze({
  name: boundedText(input.name, COMMUNITY_BADGE_NAME_MAX),
  description: boundedText(input.description, COMMUNITY_BADGE_DESCRIPTION_MAX),
  active: input.active !== false
});

export const canManageCommunityBadges = (member) =>
  member?.role === "owner" || member?.role === "moderator";
