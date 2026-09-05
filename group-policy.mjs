export const GROUP_VISIBILITIES = Object.freeze(["public", "private"]);
export const GROUP_STATUSES = Object.freeze(["active", "archived"]);
export const GROUP_ROLES = Object.freeze(["owner", "moderator", "member"]);

const text = (value, max) => String(value ?? "").trim().slice(0, max);

const slugify = (value) => text(value, 120)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 60);

export const normalizeGroup = (input = {}) => {
  const rawName = text(input.name, 60);
  const name = rawName.length >= 3 ? rawName : "";
  const visibility = GROUP_VISIBILITIES.includes(input.visibility) ? input.visibility : "public";
  return {
    name,
    slug: (() => {
      const slug = slugify(input.slug || name);
      return slug.length >= 3 ? slug : "";
    })(),
    description: text(input.description, 500),
    topic: text(input.topic, 60),
    visibility,
    premiumRequired: visibility === "private",
    status: GROUP_STATUSES.includes(input.status) ? input.status : "active"
  };
};

export const canManageGroup = (member) => member?.role === "owner";
export const canModerateGroup = (member) => member?.role === "owner" || member?.role === "moderator";
export const canSelfJoinGroup = (group) => group?.visibility === "public" && group?.status !== "archived";

const createdMillis = (post) => Number(post?.createdAtMs ?? post?.createdAt?.toMillis?.() ?? 0);
const pinnedMillis = (post) => Number(post?.pinnedAtMs ?? post?.pinnedAt?.toMillis?.() ?? 0);

export const sortGroupPosts = (posts = []) => [...posts].sort((left, right) => {
  const leftPinned = pinnedMillis(left);
  const rightPinned = pinnedMillis(right);
  if (Boolean(leftPinned) !== Boolean(rightPinned)) return Number(Boolean(rightPinned)) - Number(Boolean(leftPinned));
  if (leftPinned || rightPinned) return rightPinned - leftPinned || createdMillis(right) - createdMillis(left);
  return createdMillis(right) - createdMillis(left);
});
