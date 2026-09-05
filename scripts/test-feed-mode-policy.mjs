import assert from "node:assert/strict";

const modulePath = new URL("../feed-mode-policy.mjs", import.meta.url);
const { FEED_MODES, normalizeFeedMode, filterFeedPosts, sortFeedPosts } = await import(modulePath);

const ts = (ms) => ({ toMillis: () => ms });
const now = 1_800_000_000_000;
const posts = [
  { id: "a", authorId: "followed", createdAt: ts(now - 1_000), topics: ["music"], expiresAt: ts(now + 10_000), score: 1 },
  { id: "b", authorId: "other", createdAt: ts(now - 2_000), topics: ["sports"], score: 9 },
  { id: "c", authorId: "followed", createdAt: ts(now - 3_000), topics: ["sports", "music"], expiresAt: ts(now - 1), score: 5 },
  { id: "d", authorId: "other", createdAt: ts(now - 4_000), topics: ["news"], expiresAt: ts(now + 20_000), score: 2 }
];

assert.deepEqual(FEED_MODES, ["for-you", "latest", "following", "topics", "temporary", "saved"]);
assert.equal(normalizeFeedMode("LATEST"), "latest");
assert.equal(normalizeFeedMode("unknown"), "for-you");

const context = {
  now,
  viewerUid: "viewer",
  followedUids: new Set(["followed"]),
  selectedTopics: new Set(["music"]),
  premiumAccessUids: new Set(["other"])
};

assert.deepEqual(filterFeedPosts(posts, { ...context, mode: "following" }).map((post) => post.id), ["a"]);
assert.deepEqual(filterFeedPosts(posts, { ...context, mode: "topics" }).map((post) => post.id), ["a"]);
assert.deepEqual(filterFeedPosts(posts, { ...context, mode: "temporary" }).map((post) => post.id), ["a", "d"]);
assert.deepEqual(filterFeedPosts(posts, { ...context, mode: "latest" }).map((post) => post.id), ["a", "b", "d"]);

assert.deepEqual(sortFeedPosts(posts, "latest", context).map((post) => post.id), ["a", "b", "c", "d"]);

const rankedWithoutPremium = sortFeedPosts(posts, "for-you", { ...context, premiumAccessUids: new Set() }).map((post) => post.id);
const rankedWithPremium = sortFeedPosts(posts, "for-you", { ...context, premiumAccessUids: new Set(["other", "followed"]) }).map((post) => post.id);
assert.deepEqual(rankedWithPremium, rankedWithoutPremium, "Premium status must not affect feed order");

const saved = filterFeedPosts(posts, {
  ...context,
  mode: "saved",
  savedFilter: { mode: "topics", topics: ["sports"] }
});
assert.deepEqual(saved.map((post) => post.id), ["b"]);

console.log("Feed mode policy passed");
