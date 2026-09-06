import { extractHashtags } from "./topic-policy.mjs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const engagementScore = (post = {}) =>
  Math.max(0, Number(post.uniqueInteractions) || 0) * 3
  + Math.max(0, Number(post.commentCount) || 0) * 4
  + Math.max(0, Number(post.replyCount) || 0) * 2;

export const extractDiscoveryHashtags = (text = "") => extractHashtags(text);

export const applicationDayBounds = (now = Date.now()) => {
  const date = new Date(Number(now) || 0);
  const startMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { startMs, endMs: startMs + DAY_MS };
};

export const trendingScore = (post = {}, now = Date.now()) => {
  const createdAtMs = Number(post.createdAtMs) || 0;
  const ageMs = Number(now) - createdAtMs;
  if (!createdAtMs || ageMs < 0 || ageMs > DAY_MS) return -Infinity;
  const ageHours = ageMs / HOUR_MS;
  return engagementScore(post) + Math.max(0, 24 - ageHours);
};

export const popularTodayScore = (post = {}, now = Date.now()) => {
  const createdAtMs = Number(post.createdAtMs) || 0;
  const { startMs, endMs } = applicationDayBounds(now);
  if (!createdAtMs || createdAtMs < startMs || createdAtMs >= endMs) return -Infinity;
  return engagementScore(post) + 1;
};
