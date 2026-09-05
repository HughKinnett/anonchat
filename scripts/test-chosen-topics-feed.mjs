import fs from "node:fs";
import assert from "node:assert/strict";

// Verification touch: run this contract on the generated chosen-topics production head.
const html = fs.readFileSync("timeline.html", "utf8");
const js = fs.readFileSync("timeline.js", "utf8");

assert.match(html, /id="chosen-topic-input"/, "timeline must expose a chosen-topic input");
assert.match(html, /id="add-chosen-topic"/, "timeline must expose an add-topic control");
assert.match(html, /id="chosen-topic-list"/, "timeline must expose selected-topic chips/list");
assert.match(html, /aria-live="polite"[^>]*id="chosen-topic-status"|id="chosen-topic-status"[^>]*aria-live="polite"/, "chosen-topic feedback must be accessible");

assert.match(js, /from "\.\/topic-policy\.mjs"/, "timeline must use shared topic normalization");
assert.match(js, /let selectedTopics = new Set\(\)/, "chosen topics must be viewer-local state");
assert.match(js, /selectedTopics:\s*selectedTopics/, "topics mode must pass chosen topics into shared feed filtering");
assert.match(js, /normalizeTopic\(/, "chosen topic input must be normalized through topic-policy");
assert.match(js, /selectedTopics\.add\(/, "viewer must be able to add a chosen topic");
assert.match(js, /selectedTopics\.delete\(/, "viewer must be able to remove a chosen topic");

const visibleBeforeFilter = js.indexOf("const unexpiredPosts = visibleTimelinePosts()");
const feedFilter = js.indexOf("filterFeedPosts(unexpiredPosts");
assert.ok(visibleBeforeFilter >= 0 && feedFilter > visibleBeforeFilter, "chosen topics must filter only after existing expiry/block/moderation visibility checks");

assert.match(js, /interactionParentForPost\(postDoc\)/, "chosen topics must preserve canonical interaction parent IDs");
assert.match(js, /feed\.replaceChildren\(\.\.\.visiblePosts\.map\(renderPost\)\)/, "chosen topics must reuse the canonical post renderer");
assert.doesNotMatch(js, /collection\(db,\s*["'](?:topicPosts|chosenTopicPosts|topicReactions|topicComments)["']/, "chosen topics must not create alternate post or interaction collections");

console.log("chosen topics feed contract passed");
