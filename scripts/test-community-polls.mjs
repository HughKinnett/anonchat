import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { POLL_POST_COLLECTIONS } from "../poll-vote-policy.mjs";

const html = await readFile(new URL("../community-detail.html", import.meta.url), "utf8");
const js = await readFile(new URL("../community-detail.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.equal(POLL_POST_COLLECTIONS.includes("communityPosts"), true,
  "shared poll policy supports canonical Community posts");
assert.match(html, /id=["']community-post-kind["']/, "Community composer exposes post/poll selection");
assert.match(html, /id=["']community-poll-options["']/, "Community composer exposes bounded poll options");
assert.match(html, /data-community-poll-option/, "Community composer provides poll option inputs");

assert.match(js, /pollVoteDocumentId/, "Community polls reuse deterministic shared poll vote ids");
assert.match(js, /canonicalPollVote/, "Community polls reuse shared canonical vote validation");
assert.match(js, /["']communityVotes["']/, "Community poll votes use the canonical vote collection");
assert.match(js, /postCollection:\s*["']communityPosts["']/, "Community votes identify their canonical post collection");
assert.match(js, /category:\s*postKind\s*===\s*["']Poll["']\s*\?\s*["']Poll["']/, "poll creation marks canonical Community posts as Poll");
assert.match(js, /options\.length\s*<\s*2\s*\|\|\s*options\.length\s*>\s*4/, "Community polls require two to four options");
assert.match(js, /where\(["']postCollection["'],\s*["']==["'],\s*["']communityPosts["']\)/,
  "Community poll results query the shared vote collection by post collection");
assert.match(js, /where\(["']postId["'],\s*["']==["'],\s*post\.id\)/,
  "Community poll results are scoped to the canonical Community post id");
assert.match(js, /setDoc\(voteRef,\s*canonicalPollVote\(/,
  "Community voting writes exactly one canonical vote document per user/post");
assert.match(js, /post\.category\s*===\s*["']Poll["']/, "Community detail renders polls from canonical post data");

const voteBlock = rules.match(/match \/communityVotes\/\{voteId\} \{([\s\S]*?)\n    \}/)?.[1] || "";
assert.match(voteBlock, /postCollection in \[["']posts["'], ["']communityPosts["']\]/,
  "Firestore already authorizes canonical Community poll votes");
assert.match(voteBlock, /voteId == request\.resource\.data\.postCollection \+ ':' \+ request\.resource\.data\.postId \+ ':' \+ request\.auth\.uid/,
  "Firestore enforces one deterministic vote id per user/post");

console.log("Community poll integration tests passed");
