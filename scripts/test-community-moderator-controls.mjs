import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const js = await readFile(new URL("../community-detail.js", import.meta.url), "utf8");

assert.match(js, /setCommunityModerator/, "detail controller uses the scoped moderator role API");
assert.match(js, /setCommunityPostPinned/, "detail controller uses the scoped pin API");
assert.match(js, /currentMembership[^\n]*role\s*===\s*["']owner["']|role\s*===\s*["']owner["']/, "moderator management is owner-gated in the UI");
assert.match(js, /role\s*===\s*["']moderator["']|canModerateCommunity/, "moderators receive pin controls");
assert.match(js, /owner/i, "owner role is visibly identified");
assert.match(js, /moderator/i, "moderator role is visibly identified");
assert.match(js, /cannot.*owner|owner.*cannot|owner role cannot/i, "owner role protection is surfaced in the controller");
assert.match(js, /Pin|Unpin/, "posts expose pin or unpin actions to authorized Community staff");

console.log("Community moderator controls contract tests passed");
