export const MAX_PINNED_POSTS = 3;
export const MAX_POST_MEDIA = 4;
export const PROFILE_BIO_MAX = 240;
export const PROFILE_STATUS_MAX = 80;
export const PROFILE_INTEREST_MAX = 30;
export const PROFILE_INTEREST_COUNT = 8;

const cleanText = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);

export const normalizeProfileExtras = (input = {}) => ({
  bio: cleanText(input.bio, PROFILE_BIO_MAX),
  status: cleanText(input.status, PROFILE_STATUS_MAX),
  interests: [...new Set((Array.isArray(input.interests) ? input.interests : [])
    .map((entry) => cleanText(entry, PROFILE_INTEREST_MAX))
    .filter(Boolean))].slice(0, PROFILE_INTEREST_COUNT)
});

export const normalizePinnedPostIds = (values = []) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => String(value || "").trim())
  .filter((value) => /^[A-Za-z0-9_-]{1,160}$/.test(value)))]
  .slice(0, MAX_PINNED_POSTS);

export const normalizePostMedia = (values = []) => (Array.isArray(values) ? values : [])
  .filter((value) => typeof value === "string" && /^(?:data:image\/(?:png|jpeg|jpg|gif|webp);base64,|https:\/\/)/i.test(value))
  .slice(0, MAX_POST_MEDIA);

export const recentViewKey = (collectionName, postId) => `${String(collectionName || "posts")}:${String(postId || "")}`;

export const MESSAGE_REQUEST_PRIVACY = Object.freeze(["everyone", "following", "mutual", "nobody"]);
export const normalizeMessageRequestPrivacy = (value) => MESSAGE_REQUEST_PRIVACY.includes(value) ? value : "everyone";
export const canReceiveMessageRequest = (mode, relation = {}) => {
  const normalized = normalizeMessageRequestPrivacy(mode);
  if (normalized === "nobody") return false;
  if (normalized === "following") return relation.followsViewer === true;
  if (normalized === "mutual") return relation.followsViewer === true && relation.viewerFollows === true;
  return true;
};

export const NOTIFICATION_CATEGORIES = Object.freeze([
  "comments", "reactions", "follows", "directMessages", "messageRequests",
  "roomMessages", "mentions", "reveals", "groupMessages"
]);

export const normalizeNotificationPreferences = (input = {}) => Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((key) => [key, input[key] !== false])
);

const timeMinutes = (value) => {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]); const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

export const quietHoursActive = (quiet = {}, now = new Date()) => {
  if (!quiet?.enabled) return false;
  const start = timeMinutes(quiet.start); const end = timeMinutes(quiet.end);
  if (start === null || end === null || start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
};

export const normalizedQuietHours = (quiet = {}) => ({
  enabled: quiet.enabled === true,
  start: timeMinutes(quiet.start) === null ? "22:00" : quiet.start,
  end: timeMinutes(quiet.end) === null ? "07:00" : quiet.end
});

export const localRecentViews = (storage, uid, limit = 40) => {
  try {
    const parsed = JSON.parse(storage?.getItem?.(`anonchat:recent-views:${uid}`) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
  } catch { return []; }
};

export const recordLocalRecentView = (storage, uid, view, limit = 40) => {
  if (!uid || !storage) return [];
  const key = recentViewKey(view.collection, view.postId);
  const next = [{ ...view, key, viewedAt: Date.now() }, ...localRecentViews(storage, uid, limit)
    .filter((entry) => entry.key !== key)].slice(0, limit);
  storage.setItem(`anonchat:recent-views:${uid}`, JSON.stringify(next));
  return next;
};
