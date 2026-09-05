import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [awardSource, firestoreSource] = await Promise.all([
  readFile(new URL("../badge-awards.mjs", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../badge-firestore.mjs", import.meta.url), "utf8")
]);

assert.match(awardSource, /evaluateBadgeMilestones/, "automatic badge award service exports evaluateBadgeMilestones");
assert.match(awardSource, /awardBadgeIfMissing/, "automatic badge award service exports awardBadgeIfMissing");
assert.match(awardSource, /getDoc\s*\(/, "award service checks for an existing assignment before creating one");
assert.match(awardSource, /users["']\s*,\s*uid\s*,\s*["']badges["']\s*,\s*badgeId/, "award service writes the unique users/{uid}/badges/{badgeId} assignment path");
assert.match(awardSource, /assignedBy\s*:\s*["']system["']/, "automatic awards record system as the assigning actor");
assert.match(awardSource, /awardSource\s*:\s*["']automatic["']/, "automatic awards record their source");
assert.match(awardSource, /already-earned/, "existing assignments are preserved instead of rewritten");
assert.match(awardSource, /matchingAutomaticBadges/, "award service qualifies definitions through the milestone evaluator");

assert.match(firestoreSource, /awardSource/, "badge Firestore helper preserves assignment source metadata");

console.log("badge award contract tests passed");
