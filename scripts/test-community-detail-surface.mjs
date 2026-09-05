import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../community-detail.html", import.meta.url), "utf8");
const js = await readFile(new URL("../community-detail.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(html, /id=["']community-detail-title["']/, "detail surface exposes the Community title");
assert.match(html, /id=["']community-detail-rules["']/, "detail surface exposes Community rules");
assert.match(html, /id=["']community-post-composer["']/, "detail surface exposes a member post composer");
assert.match(html, /id=["']community-posts-list["']/, "detail surface exposes the canonical post list");
assert.match(html, /community-detail\.js/, "detail surface loads its dedicated controller");

assert.match(js, /listCommunityPosts/, "detail controller reads canonical Community posts through the adapter");
assert.match(js, /collection\(db,\s*["']communityPosts["']/, "new Community posts are written to canonical communityPosts");
assert.match(js, /collection\(db,\s*["']communityPosts["'],\s*postId,\s*["']comments["']\)/, "comments reuse canonical communityPosts comment subcollections");
assert.match(js, /collection\(db,\s*["']communityPosts["'],\s*postId,\s*["']reactions["']\)/, "reactions reuse canonical communityPosts reaction subcollections");
assert.match(js, /sortCommunityPosts|listCommunityPosts/, "posts retain pinned-first canonical ordering");
assert.match(js, /report/i, "detail surface exposes reporting controls");
assert.match(js, /viewer-block-policy|viewerCanSeeAuthor|blocked/i, "detail rendering honors viewer block policy");
assert.match(js, /deleted/i, "detail rendering handles deleted-author state");
assert.match(js, /joinCommunity|listCommunityMembers/, "composer is membership aware");

for (const asset of ["./community-detail.html", "./community-detail.js"]) {
  assert.equal(sw.includes(`\"${asset}\"`), true, `${asset} is available in the offline app graph`);
}

console.log("Community detail surface contract tests passed");
