import assert from "node:assert/strict";
import {
  applicationDayBounds,
  extractDiscoveryHashtags,
  popularTodayScore,
  trendingScore
} from "../hashtag-discovery-policy.mjs";

assert.deepEqual(
  extractDiscoveryHashtags("#Music hello #music #Indie_Rock"),
  ["music", "indie_rock"],
  "hashtags are normalized and deduplicated"
);
assert.deepEqual(extractDiscoveryHashtags("plain text"), []);

const now = Date.UTC(2026, 8, 5, 18, 0, 0);
const fresh = trendingScore({ createdAtMs: now - 60_000, uniqueInteractions: 5, commentCount: 2, replyCount: 1 }, now);
const old = trendingScore({ createdAtMs: now - 23 * 60 * 60_000, uniqueInteractions: 5, commentCount: 2, replyCount: 1 }, now);
assert.ok(fresh > old, "recency contributes to Trending");
assert.equal(trendingScore({ createdAtMs: now - 25 * 60 * 60_000, uniqueInteractions: 99, commentCount: 99, replyCount: 99 }, now), -Infinity, "posts older than 24 hours are excluded");

const bounds = applicationDayBounds(now);
assert.equal(bounds.startMs, Date.UTC(2026, 8, 5, 0, 0, 0), "application day is UTC for deterministic clients");
assert.equal(bounds.endMs, Date.UTC(2026, 8, 6, 0, 0, 0));
assert.ok(popularTodayScore({ createdAtMs: now, uniqueInteractions: 2, commentCount: 1, replyCount: 0 }, now) > 0);
assert.equal(popularTodayScore({ createdAtMs: bounds.startMs - 1, uniqueInteractions: 100 }, now), -Infinity, "Popular Today excludes posts outside the application day");

console.log("hashtag/discovery policy contract passed");
