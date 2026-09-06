import assert from "node:assert/strict";
import { blendRecommendedPosts, rankFeedPosts, scoreFeedPost } from "../feed-ranking-policy.mjs";

const now = Date.parse("2026-09-02T12:00:00Z");
const post = (id, authorId, ageHours, extra = {}) => ({
  id,
  authorId,
  ref: { path: `posts/${id}` },
  data: () => ({ authorId, content: "A useful post with enough context", createdAt: new Date(now - ageHours * 3_600_000), ...extra })
});
const followed = new Set(["friend"]);
const context = { now, viewerUid: "viewer", followedUids: followed, reactionCounts: new Map(), commentCounts: new Map(), authorAffinity: new Map(), similarAuthorAffinity: new Map() };

assert.ok(scoreFeedPost(post("fresh", "friend", 2), context) > scoreFeedPost(post("old", "friend", 72), context), "freshness decays");
assert.ok(scoreFeedPost(post("friend", "friend", 4), context) > scoreFeedPost(post("stranger", "stranger", 4), context), "follow affinity matters");
const active = post("active", "stranger", 4);
assert.ok(scoreFeedPost(active, { ...context, reactionCounts: new Map([["posts/active", 12]]), commentCounts: new Map([["posts/active", 5]]) }) > scoreFeedPost(active, context), "bounded engagement matters");
assert.ok(
  scoreFeedPost(post("affinity", "stranger", 4), { ...context, authorAffinity: new Map([["stranger", 5]]) })
  > scoreFeedPost(post("plain", "other", 4), context),
  "behavioral author affinity boosts discovery posts"
);

const ranked = rankFeedPosts([
  post("a1", "a", 1), post("a2", "a", 1.1), post("a3", "a", 1.2), post("b", "b", 2)
], context);
assert.notEqual(ranked.slice(0, 3).every(entry => entry.data().authorId === "a"), true, "author diversity interrupts monopolies");
assert.deepEqual(rankFeedPosts(ranked, context).map(entry => entry.id), rankFeedPosts(ranked, context).map(entry => entry.id), "ranking is deterministic");

const normal = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, authorId: `f${i}` }));
const recommended = [
  { id: "r1", authorId: "u1" },
  { id: "r2", authorId: "u1" },
  { id: "r3", authorId: "u2" }
];
const blended = blendRecommendedPosts(normal, recommended, { interval: 5 });
assert.equal(blended[5].id, "r1", "first recommendation follows five normal posts");
assert.equal(blended[11].id, "r3", "diversity prefers another unfamiliar author");
assert.equal(blended.filter(item => item.id.startsWith("r")).length, 2, "cadence remains bounded by normal inventory");

console.log("Personalized feed ranking policy passed.");
