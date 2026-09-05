import assert from "node:assert/strict";
import {
  normalizePinnedPostId,
  canPinPost,
  nextPinnedPostId
} from "../profile-pinning.mjs";

assert.equal(normalizePinnedPostId(" post-123 "), "post-123");
assert.equal(normalizePinnedPostId(""), null);
assert.equal(normalizePinnedPostId(null), null);

assert.equal(canPinPost({ userUid: "u1", postAuthorUid: "u1", postExists: true }), true);
assert.equal(canPinPost({ userUid: "u1", postAuthorUid: "u2", postExists: true }), false);
assert.equal(canPinPost({ userUid: "u1", postAuthorUid: "u1", postExists: false }), false);

assert.equal(nextPinnedPostId({
  currentPinnedPostId: null,
  requestedPostId: "p1",
  userUid: "u1",
  postAuthorUid: "u1",
  postExists: true
}), "p1");

assert.equal(nextPinnedPostId({
  currentPinnedPostId: "p1",
  requestedPostId: "p2",
  userUid: "u1",
  postAuthorUid: "u1",
  postExists: true
}), "p2");

assert.equal(nextPinnedPostId({
  currentPinnedPostId: "p1",
  requestedPostId: null,
  userUid: "u1",
  postAuthorUid: "u1",
  postExists: true
}), null);

assert.throws(() => nextPinnedPostId({
  currentPinnedPostId: "p1",
  requestedPostId: "p2",
  userUid: "u1",
  postAuthorUid: "u2",
  postExists: true
}), /own post/i);

assert.equal(nextPinnedPostId({
  currentPinnedPostId: "missing",
  requestedPostId: null,
  userUid: "u1",
  postAuthorUid: "u1",
  postExists: false
}), null);

console.log("profile pinning policy tests passed");
