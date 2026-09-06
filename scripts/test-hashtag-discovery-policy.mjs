import assert from "node:assert/strict";
import { extractDiscoveryHashtags, trendingScore } from "../hashtag-discovery-policy.mjs";

assert.deepEqual(
  extractDiscoveryHashtags("#Music hello #music #Indie_Rock"),
  ["music", "indie_rock"],
  "hashtags are normalized and deduplicated"
);
assert.deepEqual(extractDiscoveryHashtags("plain text"), []);

const now = Date.UTC(2026, 8, 6, 20, 0, 0);
const fresh = trendingScore({ createdAtMs: now - 60_000, uniqueInteractions: 5, commentCount: 2, replyCount: 1 }, now);
const old = trendingScore({ createdAtMs: now - 23 * 60 * 60_000, uniqueInteractions: 5, commentCount: 2, replyCount: 1 }, now);
assert.ok(fresh > old, "recency contributes to Trending");
assert.ok(
  trendingScore({ createdAtMs: now - 60_000, commentCount: 4, uniqueInteractions: 1, replyCount: 0 }, now)
  > trendingScore({ createdAtMs: now - 60_000, commentCount: 1, uniqueInteractions: 4, replyCount: 0 }, now),
  "conversation should outweigh passive reaction volume"
);
assert.ok(
  trendingScore({ createdAtMs: now - 60_000, commentCount: 1, uniqueInteractions: 1, replyCount: 3 }, now)
  > trendingScore({ createdAtMs: now - 60_000, commentCount: 1, uniqueInteractions: 1, replyCount: 0 }, now),
  "replies contribute to Trending"
);
assert.equal(
  trendingScore({ createdAtMs: now - 48 * 60 * 60 * 1000, commentCount: 100, uniqueInteractions: 100, replyCount: 100 }, now),
  -Infinity,
  "posts outside the rolling 24-hour window are excluded"
);

console.log("hashtag/trending discovery policy contract passed");
