import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timeline = await readFile(new URL("../timeline.js", import.meta.url), "utf8");
const profile = await readFile(new URL("../profile.js", import.meta.url), "utf8");

for (const [name, source] of [["timeline", timeline], ["profile", profile]]) {
  assert.match(
    source,
    /const interactionCount = reactionDocs\.length \+ commentDocs\.length;/,
    `${name} interaction total includes reactions and comments`
  );
  assert.match(
    source,
    /commentDocs\.forEach\([\s\S]*?commented/,
    `${name} interaction details identify commenters and their action`
  );
  assert.match(
    source,
    /reactionDocs\.forEach\([\s\S]*?reacted/,
    `${name} interaction details continue to identify reactions`
  );
}

assert.match(
  timeline,
  /interactionSummaryLabel\.textContent = `💬 [\s\S]*?\$\{interactionTotal\} interaction/,
  "timeline publishes an emoji and numeric interaction total immediately, including zero"
);
assert.doesNotMatch(
  timeline,
  /if \(interactionsReady\)[\s\S]{0,260}?interactionSummaryLabel\.textContent/,
  "timeline interaction total is not hidden behind a loading gate"
);

console.log("Cross-surface interaction details passed");
