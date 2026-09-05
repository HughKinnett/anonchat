import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveConnectionsTarget } from "../connections-target.mjs";

assert.deepEqual(
  resolveConnectionsTarget("?uid=other-user", "signed-in-user"),
  { targetUserId: "other-user", canonicalSearch: "?uid=other-user" },
  "connections preserves an explicitly requested profile target"
);
assert.deepEqual(
  resolveConnectionsTarget("", "signed-in-user"),
  { targetUserId: "signed-in-user", canonicalSearch: "?uid=signed-in-user" },
  "connections defaults to the signed-in user's graph"
);

const [profile, connections] = await Promise.all([
  readFile(new URL("../profile.js", import.meta.url), "utf8"),
  readFile(new URL("../connections.js", import.meta.url), "utf8")
]);
assert.match(
  profile,
  /profilePrivacy\?\.showFollowersFollowing !== false/,
  "profile uses the Phase A follower/following visibility preference"
);
assert.match(
  profile,
  /followersLink\.textContent = connectionsVisible[\s\S]*?"Followers private"/,
  "profile hides follower totals when the owner disables connection visibility"
);
assert.match(
  profile,
  /followingLink\.textContent = connectionsVisible[\s\S]*?"Following private"/,
  "profile hides following totals when the owner disables connection visibility"
);
assert.match(
  connections,
  /showFollowersFollowing !== false/,
  "connections page checks the target profile's Phase A visibility preference"
);
assert.match(
  connections,
  /Connections private/,
  "connections page renders a private state when the target hides their graph"
);

console.log("Follower graph privacy surface passed");
