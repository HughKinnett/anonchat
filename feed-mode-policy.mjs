import { rankFeedPosts } from "./feed-ranking-policy.mjs";

export const FEED_MODES = ["for-you", "latest", "following", "topics", "temporary", "saved"];

const dataFor = (record) => typeof record?.data === "function" ? record.data() : (record?.data || record || {});
const millisFor = (value) => {
  try {
    const ms = typeof value?.toMillis === "function"
      ? value.toMillis()
      : value instanceof Date
        ? value.getTime()
        : Number(value);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
};
const authorFor = (record) => {
  const post = dataFor(record);
  return post.type === "repost" ? post.originalAuthorId : post.authorId;
};
const topicSetFor = (record) => new Set((dataFor(record).topics || []).map((topic) => String(topic || "").trim().toLowerCase()).filter(Boolean));
const activeAt = (record, now) => {
  const expiresAt = dataFor(record).expiresAt;
  if (!expiresAt) return true;
  return millisFor(expiresAt) > now;
};
const temporaryAt = (record, now) => {
  const expiresAt = dataFor(record).expiresAt;
  return Boolean(expiresAt) && millisFor(expiresAt) > now;
};

export const normalizeFeedMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return FEED_MODES.includes(normalized) ? normalized : "for-you";
};

export const filterFeedPosts = (posts = [], context = {}) => {
  const now = Number(context.now) || Date.now();
  let mode = normalizeFeedMode(context.mode);
  let selectedTopics = context.selectedTopics instanceof Set
    ? context.selectedTopics
    : new Set(context.selectedTopics || []);

  if (mode === "saved") {
    const saved = context.savedFilter || {};
    mode = normalizeFeedMode(saved.mode);
    selectedTopics = new Set(saved.topics || context.selectedTopics || []);
  }

  const normalizedTopics = new Set([...selectedTopics].map((topic) => String(topic || "").trim().toLowerCase()).filter(Boolean));
  return posts
    .filter((post) => activeAt(post, now))
    .filter((post) => {
      if (mode === "following") return context.followedUids?.has(authorFor(post)) === true;
      if (mode === "topics") {
        const postTopics = topicSetFor(post);
        return [...normalizedTopics].some((topic) => postTopics.has(topic));
      }
      if (mode === "temporary") return temporaryAt(post, now);
      return true;
    });
};

export const sortScoredFeedPosts = (posts = [], scoreFor = () => 0) => [...posts].sort((left, right) => {
  const leftScore = Number(scoreFor(left));
  const rightScore = Number(scoreFor(right));
  const normalizedLeft = Number.isFinite(leftScore) ? leftScore : Number.NEGATIVE_INFINITY;
  const normalizedRight = Number.isFinite(rightScore) ? rightScore : Number.NEGATIVE_INFINITY;
  return normalizedRight - normalizedLeft;
});

export const sortFeedPosts = (posts = [], mode = "for-you", context = {}) => {
  const normalizedMode = normalizeFeedMode(mode);
  if (normalizedMode === "latest") {
    return [...posts].sort((left, right) => millisFor(dataFor(right).createdAt) - millisFor(dataFor(left).createdAt));
  }
  if (normalizedMode === "for-you") {
    const { premiumAccessUids: _ignoredPremiumAccessUids, ...rankingContext } = context;
    return rankFeedPosts([...posts], rankingContext);
  }
  return [...posts].sort((left, right) => millisFor(dataFor(right).createdAt) - millisFor(dataFor(left).createdAt));
};
