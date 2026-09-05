import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../timeline.css", import.meta.url), "utf8");

assert.match(css, /\.post-media-grid\s*\{[^}]*display:\s*grid/s, "Phase B media uses an explicit grid");
assert.match(css, /\.media-count-2|\.post-media-grid\.media-count-2/, "two-image layout has a dedicated grid rule");
assert.match(css, /\.media-count-3|\.media-count-4/, "three/four-image layouts have dedicated grid rules");
assert.match(css, /\.comment-reply\s*\{[^}]*margin-left:/s, "one-level replies are visibly indented");
assert.match(css, /\.edited-label\s*\{/, "Edited labels have dedicated styling");
assert.match(css, /\.hashtag-link\s*\{/, "hashtags have dedicated clickable styling");
assert.match(css, /@media\s*\([^)]*max-width:[^)]*\)[\s\S]*\.post-media-grid/s, "media grid has a mobile responsive rule");

console.log("Phase B responsive styling contract passed");
