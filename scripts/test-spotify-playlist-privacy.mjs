import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const profile = await readFile(new URL("../profile.js", import.meta.url), "utf8");
const css = await readFile(new URL("../timeline.css", import.meta.url), "utf8");

assert.match(profile, /spotify-playlist-embed-wrap/, "playlist embed must use a dedicated privacy wrapper");
assert.match(profile, /spotify-playlist-title-mask/, "playlist embed must add a privacy mask over Spotify's playlist-title strip");
assert.match(css, /\.spotify-playlist-title-mask\s*\{/, "playlist-title privacy mask must be styled");
assert.match(css, /pointer-events:\s*none/, "privacy mask must not trap clicks intended for Spotify controls");

console.log("Spotify playlist privacy masking policy passed.");
