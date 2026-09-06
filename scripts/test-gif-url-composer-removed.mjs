import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [html, mediaPolicy] = await Promise.all([
  read("timeline.html"),
  read("post-media-policy.mjs")
]);

assert.doesNotMatch(html, /id=["']post-gif-url["']/i, "timeline composer must not expose a raw GIF URL input");
assert.doesNotMatch(html, /class=["'][^"']*gif-url-control/i, "timeline composer must not render the GIF URL control");
assert.match(mediaPolicy, /["']gif["']/, "historical GIF media type remains supported for existing posts");
assert.match(mediaPolicy, /\burl\b/, "historical GIF media records retain URL-backed rendering compatibility");

console.log("GIF URL composer removal contract passed");
