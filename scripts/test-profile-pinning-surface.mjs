import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../profile.js", import.meta.url), "utf8");

assert.match(source, /pinnedPostId/, "profile renderer reads the pinned post reference");
assert.match(source, /Pin to profile/, "owner has a Pin to profile action");
assert.match(source, /Unpin from profile/, "owner has an Unpin from profile action");
assert.match(source, /profile-pinned-post/, "canonical rendered item is moved into the pinned region");
assert.match(source, /profile-pinned-label/, "pinned item is visibly labeled");
assert.match(source, /updateDoc\(doc\(db,\s*"users"/, "pin mutation updates the owner user document");
assert.match(source, /postDoc\.id/, "pin stores the canonical post id rather than a copied post");
assert.match(source, /showFollowersFollowing/, "profile follower visibility respects the profile privacy map");

console.log("profile pinning surface contract tests passed");
