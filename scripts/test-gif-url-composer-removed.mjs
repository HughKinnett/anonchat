import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [html, timeline, mediaPolicy] = await Promise.all([
  read("timeline.html"),
  read("timeline.js"),
  read("post-media-policy.mjs")
]);

assert.doesNotMatch(html, /id=["']post-gif-url["']/i, "timeline composer must not expose a raw GIF URL input");
assert.doesNotMatch(html, /class=["'][^"']*gif-url-control/i, "timeline composer must not render the GIF URL control");
assert.doesNotMatch(timeline, /getElementById\(["']post-gif-url["']\)|querySelector\([^\n]*post-gif-url/i,
  "timeline controller must not read a raw GIF URL composer field");
assert.doesNotMatch(timeline, /Use the GIF URL field|GIF URL field/i,
  "timeline upload copy must not direct users to a raw GIF URL field");
assert.match(mediaPolicy, /["']gif["']/, "historical GIF media type remains supported for existing posts");
assert.match(mediaPolicy, /\burl\b/, "historical GIF media records retain URL-backed rendering compatibility");

console.log("GIF URL composer removal contract passed");
