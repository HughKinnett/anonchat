import assert from "node:assert/strict";
import {
  boundedInteractionCount,
  interactionParentLoadState,
  interactionParentStateMessage,
  MAX_INTERACTION_DOCUMENTS,
  MAX_INTERACTION_ITEMS_PER_PARENT,
  MAX_INTERACTION_LISTENERS,
  MAX_INTERACTION_PARENTS,
  timelineInteractionPlan
} from "../timeline-interaction-policy.mjs";

const post = (id, data = {}) => ({ id, ref: { path: `posts/${id}`, parent: { id: "posts" } }, data: () => ({ authorId: id, ...data }) });
const records = Array.from({ length: MAX_INTERACTION_PARENTS + 20 }, (_, index) => post(`p-${index}`));
const oldRepost = post("new-repost", {
  type: "repost", sourceCollection: "posts", originalPostId: "old-original",
  originalAuthorId: "old-author", authorId: "sharer"
});
const plan = timelineInteractionPlan([oldRepost, ...records]);
assert.equal(plan.length, MAX_INTERACTION_PARENTS, "active canonical parents are operationally capped");
assert.equal(plan[0].path, "posts/old-original", "a visible repost resolves its old canonical parent outside feed windows");
assert.equal(new Set(plan.map((entry) => entry.path)).size, plan.length, "canonical parents are deduplicated");
const plannedEntries = new Map(plan.map((entry) => [entry.path, { childrenStarted: false, unavailable: false }]));
assert.equal(plannedEntries.has(records[39].ref.path), false, "the 41st canonical parent remains permanently outside the capped plan");
assert.equal(MAX_INTERACTION_ITEMS_PER_PARENT <= 100, true, "each child query has a hard document cap");
assert.equal(MAX_INTERACTION_LISTENERS, 160,
  "the worst case includes bounded parent, child, and viewer-reaction listeners");
assert.equal(MAX_INTERACTION_DOCUMENTS, 8080,
  "the total reaction/comment snapshot materialization is bounded");
assert.equal(boundedInteractionCount(99, false), "99");
assert.equal(boundedInteractionCount(100, true), "100 shown",
  "a full bounded window is identified as displayed activity, never an exact total");
assert.equal(interactionParentLoadState(plannedEntries.get(records[39].ref.path)), "unavailable",
  "the permanent 41st parent cannot masquerade as an exact zero");
assert.equal(interactionParentStateMessage("unavailable"), "Interactions not loaded in this view.");
assert.equal(interactionParentLoadState({ childrenStarted: false, unavailable: false }), "planned");
assert.equal(interactionParentLoadState({
  childrenStarted: true, unavailable: false,
  ready: { reactions: true, comments: false, viewerReaction: true }
}), "loading");
assert.equal(interactionParentLoadState({
  childrenStarted: true, unavailable: false,
  ready: { reactions: true, comments: true, viewerReaction: true }
}), "bounded");
assert.equal(interactionParentLoadState({ childrenStarted: true, unavailable: true }), "unavailable");

console.log("Timeline bounded interaction policy passed");
