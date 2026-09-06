import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const [nav, sw, timeline, community] = await Promise.all([
  read("nav-menu.js"),
  read("sw.js"),
  read("timeline.js"),
  read("community.html")
]);

assert.doesNotMatch(nav, /groups\.html/i, "shared navigation must not expose Groups");
assert.doesNotMatch(sw, /groups\.html|group-detail\.html/i, "service worker must not cache Groups routes");
assert.doesNotMatch(timeline, /groups\.html|group-detail\.html|collection\([^\n]*[\"']groups[\"']/i,
  "timeline/discovery must not link to or query Groups");
assert.match(nav, /community\.html[^\n]*Temporary Rooms/i, "Temporary Rooms must remain in shared navigation");
assert.match(nav, /premium-rooms\.html[^\n]*Premium Rooms/i, "Premium Rooms must remain in shared navigation");
assert.match(community, /Temporary Rooms|Community/i, "Temporary Rooms surface must remain present");

console.log("Groups removal contract passed");
