import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.match(rules, /function validProfilePrivacyUpdate\(userId\)/, "rules define focused profile privacy validation");
assert.match(rules, /profilePrivacy/, "rules recognize the privacy map");
for (const key of ["showPosts", "showBadges", "showFollowersFollowing", "showActivity"]) {
  assert.match(rules, new RegExp(key), `rules validate ${key}`);
}
assert.match(rules, /hasOnly\(\['showPosts', 'showBadges', 'showFollowersFollowing', 'showActivity'\]\)/, "privacy map accepts only approved keys");
assert.match(rules, /function validProfilePinUpdate\(userId\)/, "rules define focused pin validation");
assert.match(rules, /pinnedPostId/, "rules validate the pinned post reference");
assert.match(rules, /documents\/posts\/\$\(request\.resource\.data\.pinnedPostId\)/, "regular posts can be pinned");
assert.match(rules, /documents\/communityPosts\/\$\(request\.resource\.data\.pinnedPostId\)/, "community posts can be pinned");
assert.match(rules, /authorId == userId/, "pin validation requires post ownership");

console.log("phase A firestore rules contract tests passed");
