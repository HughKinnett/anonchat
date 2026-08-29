import assert from "node:assert/strict";
import {
  createViewerBlockState,
  createViewerBlockTracker,
  isBlockedActor,
  isBlockedPost,
  visibleRecords
} from "../viewer-block-policy.mjs";

const record = (path, data) => ({ id: path.split("/").at(-1), ref: { path }, data: () => data });
const viewer = "viewer";
const outgoing = record("blocks/viewer_hidden-out", { blockerUid: viewer, blockedUid: "hidden-out" });
const incoming = record("blocks/hidden-in_viewer", { blockerUid: "hidden-in", blockedUid: viewer });

const loading = createViewerBlockState({ currentUid: viewer });
assert.equal(loading.ready, false);
assert.equal(isBlockedActor("anyone", loading), true, "unknown block state fails closed");
assert.equal(isBlockedPost(record("posts/loading", { authorId: "anyone" }), loading), false,
  "posts cannot render before both block directions load");

const state = createViewerBlockState({
  currentUid: viewer,
  outgoing: [outgoing],
  incoming: [incoming],
  outgoingReady: true,
  incomingReady: true
});
assert.equal(state.ready, true);
assert.deepEqual(state.blockedUids, ["hidden-in", "hidden-out"]);
assert.deepEqual(state.outgoingUids, ["hidden-out"]);
assert.equal(isBlockedActor("hidden-out", state), true);
assert.equal(isBlockedActor("hidden-in", state), true);
assert.equal(isBlockedActor("visible", state), false);

for (const hiddenPost of [
  record("posts/outgoing", { authorId: "hidden-out" }),
  record("posts/incoming", { authorId: "hidden-in" }),
  record("posts/repost-original", { type: "repost", authorId: "visible", originalAuthorId: "hidden-in" }),
  record("posts/repost-sharer", { type: "repost", authorId: "hidden-out", originalAuthorId: "visible" })
]) assert.equal(isBlockedPost(hiddenPost, state), false, `${hiddenPost.ref.path} is hidden`);
assert.equal(isBlockedPost(record("posts/visible", { authorId: "visible" }), state), true);

const interactions = [
  record("posts/p/comments/a", { uid: "hidden-in" }),
  record("posts/p/comments/b", { uid: "visible" }),
  record("posts/p/reactions/c", { uid: "hidden-out" })
];
assert.deepEqual(visibleRecords(interactions, state, ["uid"]).map((entry) => entry.ref.path), ["posts/p/comments/b"]);

const tracker = createViewerBlockTracker(viewer);
assert.equal(tracker.update("outgoing", [outgoing]).ready, false);
assert.equal(tracker.update("incoming", [incoming]).ready, true);
assert.deepEqual(tracker.current().blockedUids, ["hidden-in", "hidden-out"]);
const failedClosed = tracker.fail("incoming");
assert.equal(failedClosed.ready, false, "a terminal listener error returns the whole policy to loading");
assert.deepEqual(failedClosed.incomingUids, [], "the failed direction cannot retain stale allow/deny data");
assert.equal(isBlockedActor("visible", failedClosed), true, "protected UI fails closed after initial readiness is lost");

console.log("Viewer block filtering policy passed");
