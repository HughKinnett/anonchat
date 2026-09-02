import assert from "node:assert/strict";
import { rankFeedPosts, scoreFeedPost } from "../feed-ranking-policy.mjs";

const now = Date.parse("2026-09-02T12:00:00Z");
const post = (id, authorId, ageHours, extra = {}) => ({
  id,
  ref: { path: `posts/${id}` },
  data: () => ({ authorId, content: "A useful post with enough context", createdAt: new Date(now - ageHours * 3_600_000), ...extra })
});
const followed = new Set(["friend"]);
const context = { now, viewerUid: "viewer", followedUids: followed, reactionCounts: new Map(), commentCounts: new Map() };

assert.ok(scoreFeedPost(post("fresh", "friend", 2), context) > scoreFeedPost(post("old", "friend", 72), context), "freshness decays");
assert.ok(scoreFeedPost(post("friend", "friend", 4), context) > scoreFeedPost(post("stranger", "stranger", 4), context), "follow affinity matters");
const active = post("active", "stranger", 4);
assert.ok(scoreFeedPost(active, { ...context, reactionCounts: new Map([["posts/active", 12]]), commentCounts: new Map([["posts/active", 5]]) }) > scoreFeedPost(active, context), "bounded engagement matters");

const ranked = rankFeedPosts([
  post("a1", "a", 1), post("a2", "a", 1.1), post("a3", "a", 1.2), post("b", "b", 2)
], context);
assert.notEqual(ranked.slice(0, 3).every(entry => entry.data().authorId === "a"), true, "author diversity interrupts monopolies");
assert.deepEqual(rankFeedPosts(ranked, context).map(entry => entry.id), rankFeedPosts(ranked, context).map(entry => entry.id), "ranking is deterministic");

console.log("Hybrid feed ranking policy passed.");
