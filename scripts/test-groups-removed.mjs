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

const [nav, sw, timeline, community] = await Promise.all([
  read("nav-menu.js"),
  read("sw.js"),
  read("timeline.js"),
  read("community.html")
]);

assert.doesNotMatch(nav, /\[\s*["']groups\.html["']\s*,\s*["']Groups["']\s*\]/i,
  "shared navigation must not expose Groups");
assert.match(nav, /querySelectorAll\([^\n]*groups\.html/i,
  "shared navigation removes stale page-level Groups links");
assert.doesNotMatch(sw, /groups\.html|group-detail\.html|group-detail\.js|private-group-detail\.js|group-firestore\.mjs|private-group-firestore\.mjs|group-policy\.mjs/i,
  "service worker must not cache Groups runtime files");
assert.doesNotMatch(timeline, /groups\.html|group-detail\.html|collection\([^\n]*[\"']groups[\"']/i,
  "timeline/discovery must not link to or query Groups");
assert.match(nav, /community\.html[^\n]*Temporary Rooms/i, "Temporary Rooms must remain in shared navigation");
assert.match(nav, /premium-rooms\.html[^\n]*Premium Rooms/i, "Premium Rooms must remain in shared navigation");
assert.match(community, /Temporary Rooms|Community/i, "Temporary Rooms surface must remain present");

const retiredFiles = [
  "groups.html",
  "groups.js",
  "group-detail.html",
  "group-detail.js",
  "group-firestore.mjs",
  "group-policy.mjs",
  "private-group-detail.js",
  "private-group-firestore.mjs",
  "scripts/apply-groups-rules-patch.mjs",
  "scripts/apply-private-group-rules-patch.mjs",
  ".github/workflows/groups-ci.yml",
  ".github/workflows/apply-groups-rules-patch.yml",
  ".github/workflows/apply-private-group-rules-patch.yml"
];

for (const path of retiredFiles) {
  assert.equal(await exists(path), false, `${path} must be removed with the Groups subsystem`);
}

console.log("Groups removal contract passed");
