import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  assertSettledModerationResult,
  gcloudCompositeIndexCreateArguments,
  gcloudCompositeIndexListArguments,
  missingRequiredIndexes,
  requiredIndexesReady,
  verifyProductionRolloutState,
  waitForRequiredIndexes
} from "../production-rollout-policy.mjs";
import { hardenRetiredFeatureRules } from "./retired-feature-rules-hardening.mjs";

const productionProcessorSource = await readFile(
  new URL("./process-production-moderation.mjs", import.meta.url),
  "utf8"
);
const voteMigrationCall = productionProcessorSource.indexOf("migratePollVotes()");
const moderationProcessorCall = productionProcessorSource.indexOf("processModeration()");
assert.ok(voteMigrationCall >= 0 && moderationProcessorCall > voteMigrationCall,
  "the privileged poll-vote migration completes before the moderation processor and strict-rules rollout");

const required = [
  {
    collectionGroup: "posts",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "moderationState", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" }
    ]
  },
  {
    collectionGroup: "rooms",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "moderationState", order: "ASCENDING" },
      { fieldPath: "expiresAt", order: "ASCENDING" },
      { fieldPath: "__name__", order: "ASCENDING" }
    ]
  }
];
const remoteIndex = (collectionGroup, fields, state = "READY") => ({
  name: `projects/anonchatlogin/databases/(default)/collectionGroups/${collectionGroup}/indexes/example`,
  queryScope: "COLLECTION",
  fields,
  state
});
const ready = [
  remoteIndex("posts", [...required[0].fields, { fieldPath: "__name__", order: "DESCENDING" }]),
  remoteIndex("rooms", required[1].fields)
];

assert.deepEqual(gcloudCompositeIndexListArguments("anonchatlogin"), [
  "firestore", "indexes", "composite", "list",
  "--project", "anonchatlogin",
  "--database", "(default)",
  "--format=json"
], "the readiness gate uses the official gcloud Firestore composite-index list command");
assert.deepEqual(gcloudCompositeIndexCreateArguments("anonchatlogin", required[0]), [
  "firestore", "indexes", "composite", "create",
  "--project", "anonchatlogin",
  "--database", "(default)",
  "--collection-group", "posts",
  "--query-scope", "collection",
  "--field-config", "field-path=moderationState,order=ascending",
  "--field-config", "field-path=createdAt,order=descending",
  "--async", "--quiet"
], "missing indexes are created additively without a deletion flag");
assert.deepEqual(missingRequiredIndexes(required, [ready[0]]), [required[1]], "only missing required indexes are created");
assert.deepEqual(missingRequiredIndexes(required, [...ready, remoteIndex("unmanaged", [], "READY")]), [],
  "unmanaged indexes are preserved");
assert.throws(() => gcloudCompositeIndexCreateArguments("anonchatlogin", {
  ...required[0], collectionGroup: "unsafe,group"
}), (error) => error.code === "INVALID_INDEX_DEFINITION");
assert.equal(requiredIndexesReady(required, ready), true, "all configured indexes are ready");
assert.equal(requiredIndexesReady(required, [{ ...ready[0], state: "CREATING" }, ready[1]]), false,
  "a creating required index keeps the rollout closed");
assert.equal(requiredIndexesReady(required, [ready[0]]), false, "a missing required index keeps the rollout closed");
assert.equal(requiredIndexesReady(required, [...ready, remoteIndex("extra", [], "CREATING")]), true,
  "an unrelated index does not block the required release set");

let now = 0;
let listCalls = 0;
await waitForRequiredIndexes({
  requiredIndexes: required,
  timeoutMs: 1_000,
  pollIntervalMs: 100,
  now: () => now,
  sleep: async (delay) => { now += delay; },
  listIndexes: async ({ timeoutMs }) => {
    assert.ok(timeoutMs > 0 && timeoutMs <= 1_000, "each list call is bounded by the remaining deadline");
    listCalls += 1;
    return listCalls === 3 ? ready : [{ ...ready[0], state: "CREATING" }, ready[1]];
  }
});
assert.equal(listCalls, 3, "readiness is polled until every required index is ready");

now = 0;
await assert.rejects(() => waitForRequiredIndexes({
  requiredIndexes: required,
  timeoutMs: 250,
  pollIntervalMs: 100,
  now: () => now,
  sleep: async (delay) => { now += delay; },
  listIndexes: async () => []
}), (error) => error.code === "INDEX_READINESS_TIMEOUT", "index readiness has a fail-closed bounded timeout");

assert.doesNotThrow(() => assertSettledModerationResult({ failed: 0, skipped: 0, roomLifecycleDeferred: 0 }));
for (const unsafe of [
  { failed: 1, skipped: 0, roomLifecycleDeferred: 0 },
  { failed: 0, skipped: 1, roomLifecycleDeferred: 0 },
  { failed: 0, skipped: 0, roomLifecycleDeferred: 1 }
]) assert.throws(() => assertSettledModerationResult(unsafe), (error) => error.code === "MODERATION_ROLLOUT_UNSETTLED");

const timestamp = (millis) => ({ toMillis: () => millis });
const completedState = {
  moderationStateBackfill: { status: "completed", completedAt: timestamp(900) },
  roomLifecycleBackfill: { status: "completed", completedAt: timestamp(900) },
  pollVoteSchemaMigration: { status: "completed", schemaVersion: 1, completedAt: timestamp(900) },
  moderationProcessor: { status: "completed", updatedAt: timestamp(950) }
};
assert.doesNotThrow(() => verifyProductionRolloutState(completedState, { nowMs: 1_000, maxHeartbeatAgeMs: 100 }));
for (const [key, value] of [
  ["moderationStateBackfill", { status: "started" }],
  ["roomLifecycleBackfill", undefined],
  ["pollVoteSchemaMigration", { status: "completed", schemaVersion: 0, completedAt: timestamp(900) }],
  ["moderationProcessor", { status: "failed", updatedAt: timestamp(950) }],
  ["moderationProcessor", { status: "completed", updatedAt: timestamp(899) }]
]) {
  const state = { ...completedState, [key]: value };
  assert.throws(() => verifyProductionRolloutState(state, { nowMs: 1_000, maxHeartbeatAgeMs: 100 }),
    (error) => error.code === "PRODUCTION_ROLLOUT_NOT_READY", `${key} must fail closed`);
}

const rulesUrl = new URL("../firestore.rules", import.meta.url);
const sourceRules = await readFile(rulesUrl, "utf8");
const hardenedRules = hardenRetiredFeatureRules(sourceRules);
assert.notEqual(hardenedRules, sourceRules, "release test hardens retired feature rules before emulator CI");
await writeFile(rulesUrl, hardenedRules);

console.log("Production rollout policy passed");
