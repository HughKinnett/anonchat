import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const exists = async (path) => {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    return true;
  } catch {
    return false;
  }
};

const [nav, sw, timeline, temporaryRooms] = await Promise.all([
  read("nav-menu.js"),
  read("sw.js"),
  read("timeline.js"),
  read("community.html")
]);

assert.doesNotMatch(nav, /communities\.html/i, "shared navigation must not expose Interest Communities");
assert.doesNotMatch(sw, /communities\.html|community-detail\.html|communities\.js|community-detail\.js|community-interest-firestore\.mjs|community-interest-policy\.mjs|community-badge-policy\.mjs/i,
  "service worker must not cache Interest Communities runtime files");
assert.doesNotMatch(timeline, /communities\.html|community-detail\.html|collection\([^\n]*[\"']communities[\"']/i,
  "timeline/discovery must not link to or query Interest Communities");
assert.match(nav, /community\.html[^\n]*Temporary Rooms/i, "Temporary Rooms must remain in shared navigation");
assert.match(temporaryRooms, /Temporary Rooms|Community/i, "Temporary Rooms page must remain present");

const retiredFiles = [
  "communities.html",
  "communities.js",
  "community-detail.html",
  "community-detail.js",
  "community-interest-firestore.mjs",
  "community-interest-policy.mjs",
  "community-badge-policy.mjs",
  "scripts/apply-communities-rules-patch.mjs",
  ".github/workflows/communities-ci.yml",
  ".github/workflows/apply-communities-rules-patch.yml"
];

for (const path of retiredFiles) {
  assert.equal(await exists(path), false, `${path} must be removed with Interest Communities`);
}

assert.equal(await exists("community.html"), true, "Temporary Rooms community.html must remain");
assert.equal(await exists("community.js"), true, "Temporary Rooms community.js must remain");

console.log("Interest Communities removal contract passed");
