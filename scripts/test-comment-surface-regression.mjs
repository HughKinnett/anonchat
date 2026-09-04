import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timeline = await readFile(new URL("../timeline.js", import.meta.url), "utf8");
const profile = await readFile(new URL("../profile.js", import.meta.url), "utf8");

assert.match(timeline, /const parent = interactionParentForPost\(postDoc\);/,
  "timeline comments and reactions resolve through the canonical interaction parent");
assert.match(profile, /commentsForPost\([\s\S]*postDoc/,
  "profile comments resolve through the canonical interaction parent policy");
assert.doesNotMatch(timeline, /commentsSection\.hidden\s*=\s*true/,
  "the Comments control must never disappear just because its canonical interaction subscription is unavailable");
assert.match(timeline, /manuallyLoadedInteractionPaths\.add\(parent\.path\)/,
  "timeline keeps an explicit canonical-parent load path for interaction recovery");
assert.match(timeline, /Comments/,
  "timeline retains a visible Comments affordance while interaction data loads or retries");

console.log("Comment surface regression policy passed");
