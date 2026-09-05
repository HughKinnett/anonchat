import assert from "node:assert/strict";
import fs from "node:fs";

const timeline = fs.readFileSync(new URL("../timeline.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../timeline.html", import.meta.url), "utf8");
const profile = fs.readFileSync(new URL("../profile.js", import.meta.url), "utf8");

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
assert.match(timeline, /media:\s*(?:composerMedia|pendingPostMedia)/, "canonical post writes include the Phase B media array");
assert.match(timeline, /postGifUrl[^\n]*value|postGifUrl\?\.value/, "GIF URL participates in composer media state");
assert.match(timeline, /collection\(db,\s*["']users["'],\s*user\.uid,\s*["']saved["']\)/, "Saved posts use a private user Firestore collection");
assert.match(timeline, /collection\(db,\s*["']users["'],\s*user\.uid,\s*["']viewHistory["']\)/, "History uses a private user Firestore collection");
assert.match(timeline, /collection\(db,\s*["']users["'],\s*user\.uid,\s*["']recentSearches["']\)/, "recent searches use a private user Firestore collection");
assert.match(timeline, /className = "hashtag-link"|className\s*=\s*["']hashtag-link["']/, "hashtags render as clickable topic links");
assert.match(timeline, /interactionParentForPost\(postDoc\)/, "Phase B preserves canonical interaction parent IDs");
assert.match(timeline, /visiblePosts\.map\(renderPost\)|map\(renderPost\)/, "feed surfaces continue to reuse the canonical post renderer");
assert.doesNotMatch(timeline, /collection\(db,\s*["'](?:phaseBPosts|savedPosts|historyPosts|trendingPosts|popularPosts)["']/, "Phase B does not create alternate post-body collections");

assert.match(profile, /from ["']\.\/post-media-policy\.mjs["']/, "profile uses the shared Phase B media policy");
assert.match(profile, /from ["']\.\/content-edit-policy\.mjs["']/, "profile uses the shared Phase B edit policy");
assert.match(profile, /from ["']\.\/threaded-reply-policy\.mjs["']/, "profile uses the shared one-level reply policy");
assert.match(profile, /from ["']\.\/saved-history-policy\.mjs["']/, "profile uses the shared Saved path policy");
assert.match(profile, /Edited/, "profile and pinned rendering show Edited state");
assert.match(profile, /post-media-grid/, "profile and pinned rendering show the canonical media set");
assert.match(profile, /groupCommentThreads\(/, "profile comment rendering uses one-level thread grouping");
assert.match(profile, /Edit post|Edit comment/, "profile owners receive the same edit actions");
assert.match(profile, /doc\(db,\s*["']users["'],\s*currentUser\.uid,\s*["']saved["']/, "profile Save action uses private Firestore Saved data");
assert.doesNotMatch(profile, /\bisBookmarked\b|\btoggleBookmark\b/, "profile no longer uses browser-local bookmarks as the Saved source of truth");

console.log("Phase B timeline/profile surface contract passed");
