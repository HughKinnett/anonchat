import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../groups.html", import.meta.url), "utf8");
const js = await readFile(new URL("../groups.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(html, /id=["']group-search["']/, "Groups discovery exposes a search control");
assert.match(html, /id=["']group-topic-filter["']/, "Groups discovery exposes a topic filter");
assert.match(html, /id=["']groups-list["']/, "Groups discovery exposes a result list");
assert.match(html, /id=["']group-create-form["']/, "Groups discovery exposes free public-group creation");
assert.match(html, /groups\.js/, "Groups discovery loads its dedicated controller");

for (const api of ["listPublicGroups", "createPublicGroup", "joinPublicGroup", "leaveGroup"]) {
  assert.match(js, new RegExp(`\\b${api}\\b`), `Groups discovery consumes ${api}`);
}
assert.match(js, /group-search/, "controller wires text search");
assert.match(js, /group-topic-filter/, "controller wires topic filtering");
assert.match(js, /memberCount/, "cards surface member counts");
assert.match(js, /Join/, "cards expose a Join action");
assert.match(js, /Leave/, "cards expose a Leave action for existing members");
assert.match(js, /group-detail\.html\?id=/, "cards navigate to Group detail by canonical id");
assert.match(js, /onAuthStateChanged/, "discovery is auth-state aware");
assert.match(js, /exitAfterAuthLoss/, "discovery uses the shared auth-loss cleanup path");
assert.match(js, /visibility:\s*["']public["']/, "public creation is explicitly free/public");

for (const asset of ["./groups.html", "./groups.js", "./group-firestore.mjs", "./group-policy.mjs"]) {
  assert.equal(sw.includes(`\"${asset}\"`), true, `${asset} is available in the offline app graph`);
}

console.log("Groups discovery surface contract tests passed");
