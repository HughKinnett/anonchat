import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const profileHtml = await readFile(new URL("../profile.html", import.meta.url), "utf8");
let privacyModule = "";
try {
  privacyModule = await readFile(new URL("../spotify-playlist-privacy.js", import.meta.url), "utf8");
} catch {}

assert.match(profileHtml, /spotify-playlist-privacy\.js/, "profile page must load the Spotify playlist privacy layer");
assert.match(privacyModule, /spotify-playlist-embed-wrap/, "privacy layer must wrap the Spotify playlist embed");
assert.match(privacyModule, /spotify-playlist-title-mask/, "privacy layer must mask Spotify's playlist-title strip");
assert.match(privacyModule, /pointerEvents\s*=\s*["']none["']/, "privacy mask must not trap clicks intended for Spotify controls");

console.log("Spotify playlist privacy masking policy passed.");
