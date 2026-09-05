export const BADGE_CATALOG = Object.freeze([
  { id: "founding-member", name: "Founding Member", description: "Joined AnonChat during its founding era.", image: "badge-founding-member.svg" },
  { id: "community-helper", name: "Community Helper", description: "Recognized for helping other community members.", image: "badge-community-helper.svg" },
  { id: "top-contributor", name: "Top Contributor", description: "Consistently contributes useful and engaging posts.", image: "badge-top-contributor.svg" },
  { id: "popular-post", name: "Popular Post", description: "Created a post that earned standout community engagement.", image: "badge-popular-post.svg" },
  { id: "long-time-member", name: "Long-Time Member", description: "A sustained member of the AnonChat community.", image: "badge-long-time-member.svg" },
  { id: "premium-member", name: "Premium Member", description: "Has AnonChat Premium access.", image: "badge-premium-member.svg" },
  { id: "moderator", name: "Moderator", description: "Helps keep AnonChat safe and welcoming.", image: "badge-moderator.svg" },
  { id: "administrator", name: "Administrator", description: "Official AnonChat administrator.", image: "badge-administrator.svg" }
]);

export const badgeById = (id, definitions = BADGE_CATALOG) => definitions.find((badge) => badge.id === id) || null;

export const normalizeBadgeDefinition = (input = {}) => {
  const id = String(input.id || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  return {
    id,
    name: String(input.name || "").trim().slice(0, 50),
    description: String(input.description || "").trim().slice(0, 180),
    image: String(input.image || "").trim().slice(0, 120),
    active: input.active !== false
  };
};

export const normalizeBadgeAward = (input = {}) => ({
  badgeId: String(input.badgeId || "").trim().slice(0, 48),
  userId: String(input.userId || "").trim().slice(0, 128),
  note: String(input.note || "").trim().slice(0, 140)
});
