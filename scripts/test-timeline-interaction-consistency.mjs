import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [timeline, profile] = await Promise.all([
  readFile(new URL("../timeline.js", import.meta.url), "utf8"),
  readFile(new URL("../profile.js", import.meta.url), "utf8")
]);

const interactionListener = timeline.match(/const startInteractionChildren = \(entry\) => \{([\s\S]*?)\n\};\n\nconst syncInteractionListeners/)?.[1] || "";
assert.ok(interactionListener, "timeline has the parent-scoped interaction listener");
assert.doesNotMatch(
  interactionListener,
  /orderBy\("createdAt"/,
  "timeline interaction listeners must include legacy comments and reactions that do not have createdAt"
);
assert.match(
  interactionListener,
  /collection\(db, entry\.parent\.collection, entry\.parent\.id, kind\)[\s\S]*limit\(MAX_INTERACTION_ITEMS_PER_PARENT\)/,
  "timeline still bounds every parent interaction stream"
);

assert.match(
  timeline,
  /reactionButton\(parent, "heart", "❤️", reactionDocs/,
  "timeline reaction controls include a heart"
);
assert.match(
  profile,
  /\["wow", "middle_finger", "laugh", "smile", "heart", "fire"\]/,
  "profile reaction controls include the same heart reaction"
);

console.log("timeline interaction consistency regression passed");