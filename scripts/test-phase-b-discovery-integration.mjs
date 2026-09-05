import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../timeline.js", import.meta.url), "utf8");

const limitMatch = source.match(/const DISCOVERY_POST_LIMIT = (\d+);/);
assert.ok(limitMatch, "timeline defines an explicit bounded discovery candidate limit");
assert.ok(Number(limitMatch[1]) >= 100 && Number(limitMatch[1]) <= 200, "discovery candidate window is useful but bounded");
assert.match(source, /limit\(DISCOVERY_POST_LIMIT\)/, "canonical post queries use the bounded discovery window");
assert.match(source, /const viewerTopicSet = new Set\(/, "suggested follows derives the viewer's public topic set");
assert.match(source, /sharedTopics:\s*candidateTopics\.filter/, "suggested follows uses shared public topics");
assert.match(source, /publicInteractions:\s*publicInteractionCountForCandidate/, "suggested follows uses public interaction signals");
assert.doesNotMatch(source, /sharedTopics:\s*0,\s*publicInteractions:\s*0/, "suggested follows no longer uses placeholder zero signals");

console.log("Phase B discovery integration contract passed");
