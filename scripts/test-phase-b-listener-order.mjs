import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../timeline.js", import.meta.url), "utf8");
const declaration = source.indexOf("const listenForSession = (reference, next, failed) => onSnapshot(");
const firstUse = source.indexOf("listeners.push(listenForSession(");

assert.ok(declaration >= 0, "timeline declares listenForSession");
assert.ok(firstUse >= 0, "timeline uses listenForSession");
assert.ok(declaration < firstUse, "listenForSession is initialized before the first Saved/History listener uses it");

console.log("Phase B listener initialization order passed");
