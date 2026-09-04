import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  boundedInteractionCount,
  interactionParentLoadState,
  interactionParentStateMessage,
  MAX_INTERACTION_ITEMS_PER_PARENT,
  timelineInteractionPlan
} from "../timeline-interaction-policy.mjs";

const post = (id, data = {}) => ({ id, ref: { path: `posts/${id}`, parent: { id: "posts" } }, data: () => ({ authorId: id, ...data }) });
const records = Array.from({ length: 60 }, (_, index) => post(`p-${index}`));
const oldRepost = post("new-repost", {
  type: "repost", sourceCollection: "posts", originalPostId: "old-original",
  originalAuthorId: "old-author", authorId: "sharer"
});
const plan = timelineInteractionPlan([oldRepost, ...records]);
assert.equal(plan.length, 61, "every canonical post thread is planned so every feed copy can load the same interactions");
assert.equal(plan[0].path, "posts/old-original", "a repost resolves to its original canonical interaction thread");
assert.equal(new Set(plan.map((entry) => entry.path)).size, plan.length, "canonical parents are deduplicated");
assert.equal(plan.some((entry) => entry.path === records[59].ref.path), true,
  "posts beyond the old 40-thread window remain eligible for interaction loading");
assert.equal(MAX_INTERACTION_ITEMS_PER_PARENT, 50, "each active child query remains bounded");
assert.equal(boundedInteractionCount(99, false), "99");
assert.equal(boundedInteractionCount(50, true), "50 shown",
  "a full bounded window is identified as displayed activity, never an exact total");
assert.equal(interactionParentLoadState(undefined), "planned",
  "a thread that has not started yet is loading, never a permanent unavailable error");
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
  /desired\.forEach\([\s\S]*?if \(existing\)[\s\S]*?startInteractionChildren\(existing\)[\s\S]*?if \(visibleParent\)[\s\S]*?startInteractionChildren\(entry\)/,
  "every planned canonical thread starts its interaction listeners instead of depending on viewport observation"
);
assert.doesNotMatch(
  timeline,
  /visibleInteractionPaths\.has\(path\)[\s\S]{0,220}?startInteractionChildren/,
  "interaction loading is not blocked by the IntersectionObserver"
);
assert.match(
  timeline,
  /if \(!snapshot\.exists\(\) \|\| isBlockedPost\(snapshot, viewerBlocks\)\)/,
  "a resolved original post is rejected only when it is missing or blocked"
);
assert.match(
  timeline,
  /interactionSummaryLabel\.textContent = `💬 \$\{activeReactionIcons \? `\$\{activeReactionIcons\} · ` : ""\}\$\{interactionTotal\} interaction/,
  "interaction summary always shows an emoji and numeric count"
);
assert.match(
  timeline,
  /commentsSummary\.textContent = `Comments · \$\{boundedInteractionCount\(/,
  "comments always expose their numeric summary once rendered"
);
assert.match(
  timeline,
  /const interactionCount = reactionDocs\.length \+ commentDocs\.length/,
  "the interaction total combines canonical reactions and comments"
);

console.log("Timeline canonical interaction loading policy passed");
