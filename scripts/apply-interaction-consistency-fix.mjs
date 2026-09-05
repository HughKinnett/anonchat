import { readFile, writeFile } from "node:fs/promises";

const timelinePath = "timeline.js";
const profilePath = "profile.js";
const contractPath = "scripts/test-timeline-moderation-ui.mjs";

let timeline = await readFile(timelinePath, "utf8");
let profile = await readFile(profilePath, "utf8");
let contract = await readFile(contractPath, "utf8");

const orderedQuery = `      query(\n        collection(db, entry.parent.collection, entry.parent.id, kind),\n        orderBy("createdAt", "desc"),\n        orderBy(documentId(), "desc"),\n        limit(MAX_INTERACTION_ITEMS_PER_PARENT)\n      ),`;
const inclusiveQuery = `      query(\n        collection(db, entry.parent.collection, entry.parent.id, kind),\n        limit(MAX_INTERACTION_ITEMS_PER_PARENT)\n      ),`;
if (!timeline.includes(orderedQuery)) throw new Error("timeline ordered interaction query not found");
timeline = timeline.replace(orderedQuery, inclusiveQuery);

const fireReaction = `reactionButton(parent, "fire", "🔥", reactionDocs`;
if (!timeline.includes(fireReaction)) throw new Error("timeline fire reaction control not found");
if (!timeline.includes(`reactionButton(parent, "heart", "❤️", reactionDocs`)) {
  timeline = timeline.replace(fireReaction, `reactionButton(parent, "heart", "❤️", reactionDocs),\n    ${fireReaction}`);
}

const profileTypes = `["wow", "middle_finger", "laugh", "smile", "fire"]`;
if (!profile.includes(profileTypes)) throw new Error("profile reaction type list not found");
profile = profile.replace(profileTypes, `["wow", "middle_finger", "laugh", "smile", "heart", "fire"]`);

const oldContract = `assert.match(timeline, /orderBy\\("createdAt", "desc"\\),\\s*orderBy\\(documentId\\(\\), "desc"\\),\\s*limit\\(MAX_INTERACTION_ITEMS_PER_PARENT\\)/,\n  "bounded interaction windows retain the newest deterministically ordered activity");\nassert.doesNotMatch(timeline, /collection\\(db, entry\\.parent\\.collection, entry\\.parent\\.id, kind\\),\\s*orderBy\\("createdAt", "asc"\\)/,\n  "bounded interaction windows never retain the oldest activity instead of the newest");`;
const newContract = `assert.doesNotMatch(timeline, /const startInteractionChildren = \\(entry\\) => \\{[\\s\\S]*?orderBy\\("createdAt"/,
  "parent-scoped interaction listeners include legacy records that do not have createdAt");
assert.match(timeline, /collection\\(db, entry\\.parent\\.collection, entry\\.parent\\.id, kind\\),\\s*limit\\(MAX_INTERACTION_ITEMS_PER_PARENT\\)/,
  "parent-scoped interaction listeners remain bounded while including legacy records");`;
if (!contract.includes(oldContract)) throw new Error("stale ordered interaction contract not found");
contract = contract.replace(oldContract, newContract);

await Promise.all([
  writeFile(timelinePath, timeline),
  writeFile(profilePath, profile),
  writeFile(contractPath, contract)
]);
console.log("interaction consistency fix applied");
