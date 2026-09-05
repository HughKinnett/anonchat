import assert from "node:assert/strict";
import fs from "node:fs";

const timeline = fs.readFileSync(new URL("../timeline.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../timeline.html", import.meta.url), "utf8");

for (const moduleName of [
  "content-edit-policy.mjs",
  "threaded-reply-policy.mjs",
  "post-media-policy.mjs",
  "saved-history-policy.mjs",
  "hashtag-discovery-policy.mjs",
  "suggested-follow-policy.mjs",
  "recent-search-policy.mjs"
]) {
  assert.match(timeline, new RegExp(`from ["']\\./${moduleName.replace(".", "\\.")}["']`), `timeline imports ${moduleName}`);
}

assert.match(html, /id="post-image-upload"[^>]*multiple/, "post composer accepts multiple images");
assert.match(html, /id="post-gif-url"/, "post composer exposes a GIF attachment control");
assert.match(html, /id="show-trending-posts"[^>]*>Trending</, "Trending feed control is visible");
assert.match(html, /id="show-popular-today-posts"[^>]*>Popular Today</, "Popular Today feed control is visible");
assert.match(html, /id="show-saved-posts"[^>]*>Saved</, "Saved screen control is visible");
assert.match(html, /id="show-history-posts"[^>]*>History</, "History screen control is visible");
assert.match(html, /id="suggested-follows"/, "suggested follows surface exists");
assert.match(html, /id="recent-searches"/, "recent-search surface exists");

assert.match(timeline, /Edited/, "post/comment rendering includes the Edited label");
assert.match(timeline, /Edit post|Edit comment/, "owners receive edit actions");
assert.match(timeline, /Reply/, "comments expose Reply actions");
assert.match(timeline, /Copy text/, "posts expose Copy text action");
assert.match(timeline, /interactionParentForPost\(postDoc\)/, "Phase B preserves canonical interaction parent IDs");
assert.match(timeline, /visiblePosts\.map\(renderPost\)|map\(renderPost\)/, "feed surfaces continue to reuse the canonical post renderer");
assert.doesNotMatch(timeline, /collection\(db,\s*["'](?:phaseBPosts|savedPosts|historyPosts|trendingPosts|popularPosts)["']/, "Phase B does not create alternate post-body collections");

console.log("Phase B timeline surface contract passed");
