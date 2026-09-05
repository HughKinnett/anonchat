export const MAX_DISCOVERY_POSTS = 60;
export const MAX_DISCOVERY_USERS = 60;
export const MAX_RECENT_SEARCHES = 12;

export const extractHashtags = (text = "") => {
  const tags = [...String(text).matchAll(/(^|\s)#([A-Za-z0-9_]{2,40})\b/g)]
    .map((match) => match[2].toLowerCase());
  return [...new Set(tags)].slice(0, 12);
};

const millis = (value) => {
  if (typeof value === "number") return value;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  return 0;
};

export const discoveryScore = (post, now = Date.now()) => {
  const ageHours = Math.max(0, (now - millis(post.createdAt)) / 3600000);
  const freshness = Math.max(0, 40 - ageHours * 2);
  const engagement = Number(post.reactions || 0) * 1.5 + Number(post.comments || 0) * 2 + Number(post.reposts || 0) * 2.5;
  return engagement + freshness;
};

export const rankDiscoveryPosts = (posts = [], now = Date.now()) => [...posts]
  .map((post) => ({ ...post, discoveryScore: discoveryScore(post, now) }))
  .sort((a, b) => b.discoveryScore - a.discoveryScore || millis(b.createdAt) - millis(a.createdAt))
  .slice(0, MAX_DISCOVERY_POSTS);

export const topicCounts = (posts = []) => {
  const counts = new Map();
  for (const post of posts) for (const tag of (post.hashtags || extractHashtags(post.content))) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};

export const suggestedPeople = ({ users = [], follows = [], viewerUid = "" } = {}) => {
  const followed = new Set(follows.filter((item) => item.followerId === viewerUid).map((item) => item.followingId));
  const followerCounts = new Map();
  for (const item of follows) followerCounts.set(item.followingId, (followerCounts.get(item.followingId) || 0) + 1);
  return users.filter((user) => user.uid !== viewerUid && !followed.has(user.uid))
    .sort((a, b) => (followerCounts.get(b.uid) || 0) - (followerCounts.get(a.uid) || 0))
    .slice(0, 12);
};

export const rememberSearch = (storage, uid, value) => {
  const text = String(value || "").trim().slice(0, 80);
  if (!storage || !uid || !text) return [];
  const key = `anonchat:recent-searches:${uid}`;
  let current = [];
  try { current = JSON.parse(storage.getItem(key) || "[]"); } catch {}
  const next = [text, ...(Array.isArray(current) ? current : []).filter((item) => item !== text)].slice(0, MAX_RECENT_SEARCHES);
  storage.setItem(key, JSON.stringify(next));
  return next;
};
