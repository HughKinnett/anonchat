import assert from "node:assert/strict";
import {
  MAX_POST_TOPICS,
  MAX_TOPIC_LENGTH,
  normalizeTopic,
  extractHashtags,
  postTopics
} from "../topic-policy.mjs";

assert.equal(normalizeTopic("  Music  "), "music", "topic normalization should trim and lowercase");
assert.equal(normalizeTopic("#MentalHealth"), "mentalhealth", "leading hashtag should be removed");
assert.equal(normalizeTopic("Web Dev"), "web-dev", "internal whitespace should normalize to hyphens");
assert.equal(normalizeTopic("News__Today"), "news__today", "safe separators should be preserved");
assert.equal(normalizeTopic("!!!"), "", "punctuation-only topic should be rejected");
assert.equal(normalizeTopic("x".repeat(MAX_TOPIC_LENGTH + 1)), "", "oversized topic should be rejected");

assert.deepEqual(
  extractHashtags("Talking about #Music, #mentalHealth and #MUSIC plus #web_dev."),
  ["music", "mentalhealth", "web_dev"],
  "hashtags should normalize and deduplicate in first-seen order"
);
assert.deepEqual(extractHashtags("email@example.com #ok ##double #"), ["ok", "double"], "hashtag parsing should ignore non-tags and empty tokens");

const many = Array.from({ length: MAX_POST_TOPICS + 4 }, (_, index) => `topic${index + 1}`);
const combined = postTopics({
  content: `#Music #music #MentalHealth ${many.map(topic => `#${topic}`).join(" ")}`,
  category: "Good News",
  topics: ["Music", "Community", "community", "x".repeat(MAX_TOPIC_LENGTH + 1)]
});
assert.equal(combined.length, MAX_POST_TOPICS, "post topics should be bounded");
assert.deepEqual(combined.slice(0, 4), ["music", "community", "good-news", "mentalhealth"], "explicit topics, category, then hashtags should normalize and deduplicate deterministically");
assert.equal(new Set(combined).size, combined.length, "post topics should not contain duplicates");
assert.ok(combined.every(topic => topic.length <= MAX_TOPIC_LENGTH), "all post topics should obey the length bound");

console.log("Topic policy passed");
