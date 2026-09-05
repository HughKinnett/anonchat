import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timeline = await readFile(new URL("../timeline.html", import.meta.url), "utf8");
const legacyCommunity = await readFile(new URL("../community.html", import.meta.url), "utf8");
const discovery = await readFile(new URL("../communities.html", import.meta.url), "utf8");
const detail = await readFile(new URL("../community-detail.html", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(timeline, /href=["']community\.html["'][^>]*>Community</,
  "timeline keeps the existing rooms/messages Community entry");
assert.match(timeline, /href=["']communities\.html["'][^>]*>Communities</,
  "timeline exposes the new interest Communities entry");
assert.match(legacyCommunity, /href=["']community\.html["'][^>]*>Community</,
  "legacy Community navigation remains intact");
assert.match(legacyCommunity, /href=["']communities\.html["'][^>]*>Communities</,
  "rooms/messages page links to interest Communities without replacing itself");
assert.match(discovery, /href=["']timeline\.html["']/, "Communities discovery can return to the timeline");
assert.match(detail, /href=["']communities\.html["']/, "Community detail can return to discovery");

for (const asset of [
  "./communities.html",
  "./communities.js",
  "./community-detail.html",
  "./community-detail.js",
  "./community-interest-policy.mjs",
  "./community-interest-firestore.mjs",
  "./community-badge-policy.mjs",
  "./poll-vote-policy.mjs"
]) assert.equal(sw.includes(`\"${asset}\"`), true, `${asset} is in the exact offline graph`);

console.log("Communities navigation and offline integration tests passed");
