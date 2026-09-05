import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../timeline.html", import.meta.url), "utf8");
const js = await readFile(new URL("../timeline.js", import.meta.url), "utf8");

for (const [id, label] of [
  ["show-all-posts", "For You"],
  ["show-latest-posts", "Latest"],
  ["show-following-posts", "Following"],
  ["show-topic-posts", "Chosen Topics"],
  ["show-temporary-posts", "Temporary Only"],
  ["show-saved-filter-posts", "Saved Filters"]
]) {
  assert.match(html, new RegExp(`id=["']${id}["'][^>]*>${label}<`), `${label} feed control must exist`);
  assert.match(html, new RegExp(`id=["']${id}["'][^>]*aria-pressed=["'](?:true|false)["']`), `${label} must expose selected state`);
}

assert.match(js, /from ["']\.\/feed-mode-policy\.mjs["']/, "timeline must consume the shared feed-mode policy");
assert.match(js, /filterFeedPosts\s*\(/, "timeline must filter through the shared feed-mode policy");
assert.match(js, /sortFeedPosts\s*\(/, "timeline must sort through the shared feed-mode policy");
assert.match(js, /feedMode\s*=\s*["']following["']/, "Following control must switch feed mode");
assert.match(js, /feedMode\s*=\s*["']topics["']/, "Chosen Topics control must switch feed mode");
assert.match(js, /feedMode\s*=\s*["']temporary["']/, "Temporary control must switch feed mode");
assert.match(js, /feedMode\s*=\s*["']saved["']/, "Saved Filters control must switch feed mode");

assert.doesNotMatch(js, /collection\(db,\s*["']feedPosts["']\)/, "feed modes must not create alternate post storage");
assert.doesNotMatch(js, /collection\(db,\s*["']feedComments["']\)/, "feed modes must not create alternate comment storage");
assert.doesNotMatch(js, /collection\(db,\s*["']feedReactions["']\)/, "feed modes must not create alternate reaction storage");

// Verification touch: ensures normal user-authored CI runs on the generated Task 2 production commit.
console.log("Feed controls surface passed");
