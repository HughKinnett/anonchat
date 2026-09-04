import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
assert.equal(plan.length, MAX_INTERACTION_PARENTS, "background canonical parents stay operationally capped");
assert.equal(plan[0].path, "posts/old-original", "a visible repost resolves its original canonical parent");
assert.equal(new Set(plan.map((entry) => entry.path)).size, plan.length, "canonical parents are deduplicated");
assert.equal(plan.some((entry) => entry.path === records[39].ref.path), false, "the background plan may omit later posts before they become visible");
assert.equal(MAX_INTERACTION_ITEMS_PER_PARENT, 50, "each child query has a small hard document cap");
assert.equal(MAX_INTERACTION_LISTENERS, 160,
  "the bounded background listener budget remains documented");
assert.equal(MAX_INTERACTION_DOCUMENTS, 4080,
  "the bounded background snapshot materialization remains documented");
assert.equal(boundedInteractionCount(99, false), "99");
assert.equal(boundedInteractionCount(50, true), "50 shown",
  "a full bounded window is identified as displayed activity, never an exact total");
assert.equal(interactionParentLoadState(undefined), "planned",
  "a post outside the background window must wait for its visible lazy load instead of showing a permanent unavailable error");
assert.equal(interactionParentStateMessage("unavailable"), "Interactions could not load. Retry.");
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

const timeline = await readFile(new URL("../timeline.js", import.meta.url), "utf8");
assert.match(
  timeline,
  /visibleInteractionPaths\.forEach\(\(path\) => \{[\s\S]*?desired\.set\(path, parent\)/,
  "every visible post outside the background cap is promoted into the canonical interaction listener set"
);
assert.match(
  timeline,
  /const interactionTotal = reactionsReady && commentsReady[\s\S]*?commentDocs\.length/,
  "interaction totals are derived from the same loaded canonical reactions and comments"
);

console.log("Timeline visible interaction policy passed");
