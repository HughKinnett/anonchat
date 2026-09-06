import assert from "node:assert/strict";
import { buildOriginalPost, buildRepost } from "../content-writer-policy.mjs";

const timestamp = "server-time";
assert.deepEqual(buildOriginalPost({
  authorId: "writer", username: "writer_name", content: "hello", imageData: "", media: [{ type: "image", url: "a" }, { type: "image", url: "b" }], category: "Post", options: [], expiresAt: null, createdAt: timestamp
}), {
  type: "original", authorId: "writer", username: "writer_name", content: "hello", imageData: "a", media: [{ type: "image", url: "a" }, { type: "image", url: "b" }], category: "Post", options: [], expiresAt: null, moderationState: "visible", createdAt: timestamp, topics: ["post"]
});
assert.deepEqual(buildRepost({
  authorId: "writer", username: "writer_name", sourceCollection: "posts", originalPostId: "source", originalAuthorId: "author", originalUsername: "author_name", content: "shared", imageData: "a", media: [{ type: "gif", url: "g" }], createdAt: timestamp
}), {
  type: "repost", authorId: "writer", username: "writer_name", sourceCollection: "posts", originalPostId: "source", originalAuthorId: "author", originalUsername: "author_name", content: "shared", imageData: "g", media: [{ type: "gif", url: "g" }], moderationState: "visible", createdAt: timestamp, topics: []
});
console.log("Content writer policy passed");
