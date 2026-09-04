import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveConnectionsTarget } from "../connections-target.mjs";

assert.deepEqual(
  resolveConnectionsTarget("?uid=other-user", "signed-in-user"),
  { targetUserId: "signed-in-user", canonicalSearch: "?uid=signed-in-user" },
  "connections always resolves to the signed-in user's private follower/following graph"
);
assert.deepEqual(
  resolveConnectionsTarget("", "signed-in-user"),
  { targetUserId: "signed-in-user", canonicalSearch: "?uid=signed-in-user" },
  "connections defaults to the signed-in user's graph"
);

const profile = await readFile(new URL("../profile.js", import.meta.url), "utf8");
assert.match(
  profile,
  /const ownConnectionsVisible = targetUserId === user\.uid;/,
  "profile explicitly gates follower/following details to the profile owner"
);
assert.match(
  profile,
  /followersLink\.textContent = ownConnectionsVisible[\s\S]*?"Followers private"/,
  "other users' follower totals are not rendered"
);
assert.match(
  profile,
  /followingLink\.textContent = ownConnectionsVisible[\s\S]*?"Following private"/,
  "other users' following totals are not rendered"
);

console.log("Follower graph privacy surface passed");
