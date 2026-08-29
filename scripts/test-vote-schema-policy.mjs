import assert from "node:assert/strict";
import {
  legacyVoteTargetCollection,
  voteBelongsToTarget,
  voteDocumentPlan
} from "../vote-schema-policy.mjs";

const createdAt = Symbol("server timestamp");
assert.deepEqual(voteDocumentPlan({
  postCollection: "posts", postId: "shared", uid: "member", option: 1, createdAt
}), {
  id: "posts_shared_member",
  data: { postCollection: "posts", postId: "shared", uid: "member", option: 1, createdAt }
});
assert.deepEqual(voteDocumentPlan({
  postCollection: "communityPosts", postId: "shared", uid: "member", option: 2, createdAt
}), {
  id: "communityPosts_shared_member",
  data: { postCollection: "communityPosts", postId: "shared", uid: "member", option: 2, createdAt }
});
assert.throws(() => voteDocumentPlan({
  postCollection: "posts", postId: "shared", uid: "member", option: 4, createdAt
}), /option/i);

const knownTargets = { postIds: new Set(["timeline", "shared"]), communityPostIds: new Set(["community", "shared"]) };
assert.equal(voteBelongsToTarget(
  { postCollection: "posts", postId: "shared" }, { postCollection: "posts", postId: "shared" }, knownTargets
), true);
assert.equal(voteBelongsToTarget(
  { postCollection: "posts", postId: "shared" }, { postCollection: "communityPosts", postId: "shared" }, knownTargets
), false, "new same-ID votes never cross target collections");
assert.equal(legacyVoteTargetCollection({ postId: "timeline" }, knownTargets), "posts");
assert.equal(legacyVoteTargetCollection({ postId: "community" }, knownTargets), "communityPosts");
assert.equal(legacyVoteTargetCollection({ postId: "shared" }, knownTargets), null,
  "same-ID legacy votes remain ambiguous rather than being guessed");
assert.equal(voteBelongsToTarget(
  { postId: "timeline" }, { postCollection: "posts", postId: "timeline" }, knownTargets
), true, "unambiguous legacy votes remain visible until backfilled");
assert.equal(voteBelongsToTarget(
  { postId: "shared" }, { postCollection: "posts", postId: "shared" }, knownTargets
), false, "ambiguous legacy votes are not attributed to either target");

console.log("Vote schema policy passed");
