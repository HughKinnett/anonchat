export const COMMUNITY_VISIBILITIES = Object.freeze(["public"]);
export const COMMUNITY_STATUSES = Object.freeze(["active", "archived"]);
export const COMMUNITY_ROLES = Object.freeze(["owner", "moderator", "member"]);
export const COMMUNITY_RULE_LIMIT = 10;

const text = (value, max) => String(value ?? "").trim().slice(0, max);

const slugify = (value) => text(value, 120)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);

export const normalizeCommunityRules = (rules = []) => (Array.isArray(rules) ? rules : [])
  .map((rule) => text(rule, 180))
  .filter(Boolean)
  .slice(0, COMMUNITY_RULE_LIMIT);

export const normalizeCommunity = (input = {}) => {
  const rawName = text(input.name, 60);
  const name = rawName.length >= 3 ? rawName : "";
  const slug = slugify(input.slug || name);
  const topic = slugify(input.topic).replaceAll("-", "_");
  return {
    name,
    slug: slug.length >= 3 ? slug : "",
    description: text(input.description, 500),
    topic,
    rules: normalizeCommunityRules(input.rules),
    visibility: "public",
    status: COMMUNITY_STATUSES.includes(input.status) ? input.status : "active"
  };
};

export const canManageCommunity = (member) => member?.role === "owner";
export const canModerateCommunity = (member) => member?.role === "owner" || member?.role === "moderator";

const createdMillis = (post) => Number(post?.createdAtMs ?? post?.createdAt?.toMillis?.() ?? 0);
const pinnedMillis = (post) => Number(post?.pinnedAtMs ?? post?.pinnedAt?.toMillis?.() ?? 0);

export const sortCommunityPosts = (posts = []) => [...posts].sort((left, right) => {
  const leftPinned = pinnedMillis(left);
  const rightPinned = pinnedMillis(right);
  if (Boolean(leftPinned) !== Boolean(rightPinned)) return Number(Boolean(rightPinned)) - Number(Boolean(leftPinned));
  if (leftPinned || rightPinned) return rightPinned - leftPinned || createdMillis(right) - createdMillis(left);
  return createdMillis(right) - createdMillis(left);
});
