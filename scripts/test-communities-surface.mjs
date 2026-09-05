import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../communities.html", import.meta.url), "utf8");
const js = await readFile(new URL("../communities.js", import.meta.url), "utf8");
const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");

assert.match(html, /id=["']community-search["']/, "Communities discovery exposes a search control");
assert.match(html, /id=["']community-topic-filter["']/, "Communities discovery exposes a topic filter");
assert.match(html, /id=["']communities-list["']/, "Communities discovery exposes a result list");
assert.match(html, /communities\.js/, "Communities discovery loads its dedicated controller");

for (const api of ["listCommunities", "joinCommunity", "leaveCommunity"]) {
  assert.match(js, new RegExp(`\\b${api}\\b`), `Communities discovery consumes ${api}`);
}
assert.match(js, /community-search/, "controller wires text search");
assert.match(js, /community-topic-filter/, "controller wires topic filtering");
assert.match(js, /memberCount/, "cards surface member counts");
assert.match(js, /Join/, "cards expose a Join action");
assert.match(js, /Leave/, "cards expose a Leave action for existing members");
assert.match(js, /community-detail\.html\?id=/, "cards navigate to Community detail by canonical id");
assert.match(js, /onAuthStateChanged/, "discovery is auth-state aware");
assert.match(js, /exitAfterAuthLoss/, "discovery uses the shared auth-loss cleanup path");

for (const asset of ["./communities.html", "./communities.js", "./community-interest-firestore.mjs", "./community-interest-policy.mjs"]) {
  assert.equal(sw.includes(`\"${asset}\"`), true, `${asset} is available in the offline app graph`);
}

console.log("Communities discovery surface contract tests passed");
