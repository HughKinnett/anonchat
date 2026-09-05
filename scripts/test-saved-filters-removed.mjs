import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, js] = await Promise.all([
  readFile(new URL("../timeline.html", import.meta.url), "utf8"),
  readFile(new URL("../timeline.js", import.meta.url), "utf8"),
]);

assert.equal(html.includes('id="show-saved-filter-posts"'), false, "Saved Filters feed control must be removed");
assert.equal(html.includes(">Saved Filters<"), false, "Saved Filters label must not appear in the timeline UI");
assert.equal(js.includes('document.getElementById("show-saved-filter-posts")'), false, "Saved Filters controller lookup must be removed");
assert.equal(js.includes('feedMode = "saved"'), false, "Saved Filters mode switching must be removed from timeline controller");

console.log("Saved Filters removal contract passed");
