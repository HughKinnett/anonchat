import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../timeline.js", import.meta.url), "utf8");

const limitMatch = source.match(/const DISCOVERY_POST_LIMIT = (\d+);/);
assert.ok(limitMatch, "timeline defines an explicit bounded discovery candidate limit");
assert.ok(Number(limitMatch[1]) >= 100 && Number(limitMatch[1]) <= 200, "discovery candidate window is useful but bounded");
assert.match(source, /const TIMELINE_POST_LIMIT = \d+;/, "canonical timeline keeps its own bounded post limit");
for (const collectionName of ["posts", "communityPosts"]) {
  assert.match(source,
    new RegExp(`query\\(collection\\(db, "${collectionName}"\\), where\\("moderationState", "==", "visible"\\), orderBy\\("createdAt", "desc"\\), limit\\(TIMELINE_POST_LIMIT\\)\\)`),
    `${collectionName} keeps the canonical timeline query limit`
  );
  assert.match(source,
    new RegExp(`query\\(collection\\(db, "${collectionName}"\\), where\\("moderationState", "==", "visible"\\), orderBy\\("createdAt", "desc"\\), limit\\(DISCOVERY_POST_LIMIT\\)\\)`),
    `${collectionName} has a separate bounded discovery candidate query`
  );
}
assert.match(source, /let discoveryPostDocs = \[\];/, "timeline stores discovery posts separately from canonical posts");
assert.match(source, /let discoveryCommunityPostDocs = \[\];/, "timeline stores discovery community posts separately from canonical posts");
assert.match(source, /const discoveryTimelinePosts = \(\) => \[\.\.\.discoveryPostDocs, \.\.\.discoveryCommunityPostDocs\];/, "discovery feeds have a separate candidate source");
assert.match(source, /const viewerTopicSet = new Set\(/, "suggested follows derives the viewer's public topic set");
assert.match(source, /const viewerFollowingSet = new Set\(/, "suggested follows derives the viewer's follow graph");
assert.match(source, /mutuals:\s*visibleFollows\(\)\.filter/, "suggested follows counts real mutual connections");
assert.match(source, /sharedTopics:\s*candidateTopics\.filter/, "suggested follows uses shared public topics");
assert.match(source, /viewerComments:\s*suggestionPosts\.filter/, "suggested follows uses viewer comment affinity");
assert.match(source, /viewerReactions:\s*suggestionPosts\.filter/, "suggested follows uses viewer reaction affinity");
assert.match(source, /sharedInteractions:\s*publicInteractionCountForCandidate/, "suggested follows uses shared public interaction signals");
assert.match(source, /lastAffinityAtMs:\s*lastAffinityByAuthor\.get/, "suggested follows forwards affinity recency");
assert.doesNotMatch(source, /mutuals:\s*0,/, "suggested follows no longer uses a placeholder mutual score");
assert.doesNotMatch(source, /sharedTopics:\s*0,\s*(?:publicInteractions|sharedInteractions):\s*0/, "suggested follows no longer uses placeholder zero signals");

console.log("Phase B behavioral discovery integration contract passed");
