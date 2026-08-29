import assert from "node:assert/strict";
import { interactionParentForPost } from "../interaction-parent-policy.mjs";

const post = (path, data) => {
  const [collection, id] = path.split("/");
  return { ref: { path, parent: { id: collection } }, id, data: () => data };
};

assert.deepEqual(
  interactionParentForPost(post("posts/original", { type: "original" })),
  { collection: "posts", id: "original", path: "posts/original" }
);
assert.deepEqual(
  interactionParentForPost(post("communityPosts/original", { type: "original" })),
  { collection: "communityPosts", id: "original", path: "communityPosts/original" }
);
assert.deepEqual(
  interactionParentForPost(post("posts/repost", { type: "repost", sourceCollection: "communityPosts", originalPostId: "original" })),
  { collection: "communityPosts", id: "original", path: "communityPosts/original" }
);
assert.deepEqual(
  interactionParentForPost(post("posts/legacy-repost", { type: "repost", originalPostId: "original" })),
  { collection: "posts", id: "original", path: "posts/original" },
  "legacy reposts retain the former posts-only source behavior"
);
assert.notEqual(
  interactionParentForPost(post("posts/repost", { type: "repost", sourceCollection: "posts", originalPostId: "same-id" })).path,
  interactionParentForPost(post("posts/repost", { type: "repost", sourceCollection: "communityPosts", originalPostId: "same-id" })).path,
  "equal ids in different collections remain distinct interaction parents"
);

console.log("Interaction parent policy passed");
