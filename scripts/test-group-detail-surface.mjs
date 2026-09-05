import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../group-detail.html", import.meta.url), "utf8");
const js = await readFile(new URL("../group-detail.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(html, /id=["']group-detail-title["']/, "Group detail exposes a canonical title surface");
assert.match(html, /id=["']group-post-composer["']/, "Group detail exposes a member post composer");
assert.match(html, /id=["']group-posts-list["']/, "Group detail exposes the canonical post list");
assert.match(html, /group-detail\.js/, "Group detail loads its dedicated controller");

for (const api of ["getGroup", "listGroupMembers", "listGroupPosts", "setGroupPostPinned"]) {
  assert.match(js, new RegExp(`\\b${api}\\b`), `Group detail consumes ${api}`);
}
assert.match(js, /communityPosts/, "Group discussions reuse canonical communityPosts storage");
assert.match(js, /comments/, "Group discussions reuse canonical post comments");
assert.match(js, /reactions/, "Group discussions reuse canonical post reactions");
assert.match(js, /communityVotes/, "Group polls reuse canonical communityVotes storage");
assert.match(js, /canonicalPollVote/, "Group polls reuse canonical poll vote validation");
assert.match(js, /createModerationClient/, "Group detail reuses the shared moderation client");
assert.match(js, /REPORT_REASONS/, "Group posts expose the shared report reasons");
assert.match(js, /isPairBlocked/, "Group detail hides blocked-user content using the shared block policy");
assert.match(js, /deleted/, "Group detail renders a deleted-author fallback");
assert.match(js, /pinnedAt/, "Group detail surfaces pinned canonical posts");
assert.match(js, /exitAfterAuthLoss/, "Group detail uses the shared auth-loss cleanup path");

for (const asset of ["./group-detail.html", "./group-detail.js", "./group-firestore.mjs", "./group-policy.mjs"]) {
  assert.equal(sw.includes(`\"${asset}\"`), true, `${asset} is available in the offline app graph`);
}

console.log("Group detail surface contract tests passed");
