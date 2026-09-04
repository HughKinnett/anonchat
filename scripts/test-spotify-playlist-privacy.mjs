import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sharing = await readFile(new URL("../post-sharing.js", import.meta.url), "utf8");
const privacy = await readFile(new URL("../spotify-playlist-privacy.js", import.meta.url), "utf8");
const css = await readFile(new URL("../sharing-privacy.css", import.meta.url), "utf8");

for (const [name, source] of [["sharing", sharing], ["playlist privacy", privacy]]) {
  assert.match(source, /host\.append\(mask\)/, `${name} mask must overlay the iframe instead of creating a banner above it`);
  assert.doesNotMatch(source, /insertBefore\(mask,\s*frame\)/, `${name} mask must not displace the Spotify iframe`);
}
assert.match(css, /\.spotify-playlist-name-mask\{[^}]*top:2[024]px[^}]*left:1(?:3[468]|4[0-9])px[^}]*right:/, "privacy mask must cover Spotify's internal playlist-title region, not the whole embed header");
assert.match(css, /pointer-events:none/, "privacy mask must not trap clicks intended for Spotify controls");

console.log("Spotify playlist title masking policy passed.");
