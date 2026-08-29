import assert from "node:assert/strict";
import { createSessionGeneration } from "../session-generation-policy.mjs";

const sessions = createSessionGeneration();
const sessionA = sessions.begin("user-a");
assert.equal(sessions.isCurrent(sessionA, "user-a"), true);
const sessionB = sessions.begin("user-b");
assert.equal(sessions.isCurrent(sessionA, "user-a"), false, "queued callbacks from A are stale after B begins");
assert.equal(sessions.isCurrent(sessionB, "user-b"), true);
assert.equal(sessions.isCurrent(sessionB, "user-a"), false, "a generation cannot be reused for another uid");
sessions.invalidate();
assert.equal(sessions.isCurrent(sessionB, "user-b"), false, "page exit invalidates queued callbacks");

console.log("Auth session generation policy passed");
