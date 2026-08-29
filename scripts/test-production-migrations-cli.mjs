import assert from "node:assert/strict";
import { runProductionMigrations } from "./production-migrations.mjs";

const calls = [];
const result = await runProductionMigrations({
  moderationStatus: async (argumentsList) => {
    calls.push(["moderation-status", ...argumentsList]);
    return { eligible: argumentsList.includes("--apply") ? 3 : calls.length === 1 ? 3 : 0 };
  },
  voteSchema: async (argumentsList) => {
    calls.push(["vote-schema", ...argumentsList]);
    return { eligible: argumentsList.includes("--apply") ? 2 : calls.length === 4 ? 2 : 0, ambiguous: 1 };
  }
});

assert.deepEqual(calls, [
  ["moderation-status"],
  ["moderation-status", "--apply"],
  ["moderation-status"],
  ["vote-schema"],
  ["vote-schema", "--apply"],
  ["vote-schema"]
], "production migrations dry-run, apply, and verify each schema in dependency order");
assert.equal(result.moderationStatus.verify.eligible, 0);
assert.equal(result.voteSchema.verify.eligible, 0);
assert.equal(result.voteSchema.verify.ambiguous, 1, "ambiguous legacy votes remain preserved for audit");

await assert.rejects(() => runProductionMigrations({
  moderationStatus: async (argumentsList) => ({ eligible: argumentsList.includes("--apply") ? 1 : 1 }),
  voteSchema: async () => ({ eligible: 0 })
}), /MODERATION_STATUS_MIGRATION_INCOMPLETE/);

await assert.rejects(() => runProductionMigrations({
  moderationStatus: async () => ({ eligible: 0 }),
  voteSchema: async (argumentsList) => ({ eligible: argumentsList.includes("--apply") ? 1 : 1 })
}), /VOTE_SCHEMA_MIGRATION_INCOMPLETE/);

console.log("Production migration CLI contract passed");
