import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../timeline.html", import.meta.url), "utf8");

assert.match(
  html,
  /id="show-saved-filter-posts"[^>]*hidden[^>]*aria-hidden="true"/,
  "Saved Filters compatibility control must be hidden from the timeline"
);

console.log("Saved Filters removal contract passed");
