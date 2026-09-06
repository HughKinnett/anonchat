import assert from "node:assert/strict";
import fs from "node:fs";

const timeline = fs.readFileSync(new URL("../timeline.js", import.meta.url), "utf8");

assert.match(timeline, /blendRecommendedPosts/, "timeline imports or calls the recommendation blend helper");
assert.match(timeline, /viewerComments|commentAffinity/, "timeline builds comment affinity for suggested follows");
assert.match(timeline, /viewerReactions|reactionAffinity/, "timeline builds reaction affinity for suggested follows");
assert.match(timeline, /lastAffinityAtMs/, "timeline forwards recency for suggested follows");
assert.match(timeline, /authorAffinity/, "timeline builds author affinity for For You ranking");
assert.match(timeline, /feedMode\s*===\s*["']for-you["'][\s\S]{0,2200}?blendRecommendedPosts|blendRecommendedPosts\([\s\S]{0,800}?feedMode\s*===\s*["']for-you["']/, "For You explicitly blends recommended posts");
assert.doesNotMatch(timeline, /feedMode\s*===\s*["']following["'][\s\S]{0,800}?blendRecommendedPosts/, "Following mode must not inject recommended posts");
assert.match(timeline, /suggestFollowCandidates\s*\(/, "timeline invokes suggested follow policy");

console.log("timeline personalized recommendation wiring contract passed");
