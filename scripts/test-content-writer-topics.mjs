import assert from "node:assert/strict";
import { buildOriginalPost, buildRepost } from "../content-writer-policy.mjs";

const createdAt = { seconds: 123 };
const original = buildOriginalPost({
  authorId: "u1",
  username: "anon",
  content: "A #Music update about #MentalHealth and #music",
  imageData: "",
  category: "Good News",
  options: [],
  expiresAt: null,
  createdAt,
  topics: ["Community", "MUSIC"]
});
assert.deepEqual(original.topics, ["community", "music", "good-news", "mentalhealth"], "original posts should persist normalized canonical topics");

const repost = buildRepost({
  authorId: "u2",
  username: "anon2",
  sourceCollection: "posts",
  originalPostId: "p1",
  originalAuthorId: "u1",
  originalUsername: "anon",
  content: "Reposting #Music",
  imageData: "",
  createdAt,
  topics: ["Community"]
});
assert.deepEqual(repost.topics, ["community", "music"], "reposts should persist normalized canonical topics");

console.log("Content writer topic metadata passed");
