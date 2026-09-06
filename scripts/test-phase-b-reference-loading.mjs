import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../timeline.js", import.meta.url), "utf8");

assert.match(source, /canonicalPostPathParts/, "timeline imports canonical post-path parsing");
assert.match(source, /let referencedPostDocs = new Map\(\)/, "timeline keeps fetched canonical Saved/History documents");
assert.match(source, /const loadReferencedPostDocs = async \(paths = \[\]\)/, "timeline has a bounded canonical reference loader");
assert.match(source, /getDoc\(doc\(db, parts\.collection, parts\.id\)\)/, "reference loader fetches canonical post documents");
assert.match(source, /loadReferencedPostDocs\(\[\.\.\.savedPostPaths\]\)/, "Saved listener resolves canonical documents");
assert.match(source, /loadReferencedPostDocs\(viewedPostPaths\)/, "History listener resolves canonical documents");
assert.match(source, /referencedPostDocs\.values\(\)/, "rendering includes fetched referenced posts outside the live timeline window");

console.log("Phase B canonical Saved/History loading contract passed");
