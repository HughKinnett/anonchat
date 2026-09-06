import assert from "node:assert/strict";
import { reconcileAllExistingUsers } from "../badge-full-reconciliation.mjs";

const identityCalls = [];
const activityCalls = [];
const identityPages = new Map([
  [null, { evaluated: 3, inspected: 3, batches: 1, nextCursor: "u3" }],
  ["u3", { evaluated: 2, inspected: 2, batches: 1, nextCursor: null }]
]);
const activityPages = new Map([
  [null, { evaluated: 2, inspected: 2, batches: 1, nextCursor: "u2" }],
  ["u2", { evaluated: 2, inspected: 2, batches: 1, nextCursor: "u4" }],
  ["u4", { evaluated: 1, inspected: 1, batches: 1, nextCursor: null }]
]);

const result = await reconcileAllExistingUsers({
  adapter: { name: "fake" },
  reconcileIdentity: async ({ startCursor }) => {
    identityCalls.push(startCursor ?? null);
    return identityPages.get(startCursor ?? null);
  },
  reconcileActivity: async ({ startCursor }) => {
    activityCalls.push(startCursor ?? null);
    return activityPages.get(startCursor ?? null);
  }
});

assert.deepEqual(identityCalls, [null, "u3"], "identity/status backfill follows every returned cursor");
assert.deepEqual(activityCalls, [null, "u2", "u4"], "activity backfill follows every returned cursor");
assert.deepEqual(result, {
  completed: true,
  identityUsers: 5,
  activityUsers: 5,
  identityPasses: 2,
  activityPasses: 3,
  nextIdentityCursor: null,
  nextActivityCursor: null
});

await assert.rejects(() => reconcileAllExistingUsers({
  adapter: { name: "fake" },
  reconcileIdentity: async () => ({ evaluated: 1, nextCursor: "stuck" }),
  reconcileActivity: async () => ({ evaluated: 0, nextCursor: null })
}), /cursor did not advance/i, "full backfill refuses to loop forever on a stuck cursor");

console.log("Full existing-user badge reconciliation contract passed.");
