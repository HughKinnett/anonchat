import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [awardSource, firestoreSource, processorSource, adapterSource] = await Promise.all([
  readFile(new URL("../badge-awards.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-firestore.mjs", import.meta.url), "utf8"),
  readFile(new URL("../badge-award-processor.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-award-firestore-adapter.mjs", import.meta.url), "utf8").catch(() => "")
]);

assert.match(awardSource, /evaluateBadgeMilestones/, "automatic badge award service exports evaluateBadgeMilestones");
assert.match(awardSource, /matchingAutomaticBadges/, "award service qualifies definitions through the milestone evaluator");
assert.doesNotMatch(awardSource, /setDoc\s*\(/, "browser award helper never writes badge assignments directly");
assert.doesNotMatch(awardSource, /users["']\s*,\s*uid\s*,\s*["']badges["']/, "browser award helper never targets the protected assignment path");

assert.match(processorSource, /processBadgeAwards/, "trusted badge processor exports processBadgeAwards");
assert.match(processorSource, /matchingAutomaticBadges/, "trusted processor uses the milestone evaluator");
assert.match(processorSource, /already-earned/, "trusted processor preserves existing badge assignments");
assert.match(processorSource, /changedMetrics/, "trusted processor evaluates only the metrics changed by canonical activity");

assert.match(adapterSource, /users.*badges|badges.*users/s, "trusted Firestore adapter owns user badge assignment writes");
assert.match(adapterSource, /runTransaction/, "trusted adapter performs idempotent badge assignment writes transactionally");
assert.match(adapterSource, /badgeTypes/, "trusted adapter reads badge definitions");
assert.match(adapterSource, /assignedBy\s*:\s*["']system["']/, "trusted adapter records system as the assigning actor");
assert.match(adapterSource, /awardSource\s*:\s*["']automatic["']/, "trusted adapter records automatic award source");

assert.match(firestoreSource, /awardSource/, "badge Firestore helper preserves assignment source metadata");

console.log("badge award contract tests passed");
