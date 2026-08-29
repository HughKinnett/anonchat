import assert from "node:assert/strict";
import {
  fixedResultSummary,
  main,
  parseArguments,
  resolveProjectId
} from "./backfill-vote-schema.mjs";

assert.deepEqual(parseArguments([]), { apply: false });
assert.deepEqual(parseArguments(["--apply"]), { apply: true });
assert.throws(() => parseArguments(["--dry-run"]), /INVALID_ARGUMENT/);
assert.equal(resolveProjectId({ GCLOUD_PROJECT: "vote-project" }), "vote-project");
assert.equal(resolveProjectId({}), "anonchatlogin");

const dryRunResult = {
  mode: "dry-run", scanned: 5, eligible: 2, migrated: 0,
  ambiguous: 2, alreadyMigrated: 1, batches: 0
};
assert.equal(fixedResultSummary(dryRunResult),
  "VOTE_BACKFILL_RESULT mode=dry-run scanned=5 eligible=2 migrated=0 ambiguous=2 alreadyMigrated=1 batches=0");

let invocation;
let closed = false;
const returned = await main([], {
  env: { GCLOUD_PROJECT: "vote-project" },
  createRuntime: async () => ({ adapter: { kind: "vote-adapter" }, close: async () => { closed = true; } }),
  runner: async parameters => { invocation = parameters; return dryRunResult; }
});
assert.equal(invocation.adapter.kind, "vote-adapter");
assert.equal(invocation.apply, false);
assert.equal(returned, dryRunResult);
assert.equal(closed, true);

let applied = false;
await main(["--apply"], {
  createRuntime: async () => ({ adapter: {}, close: async () => {} }),
  runner: async parameters => { applied = parameters.apply; return { ...dryRunResult, mode: "apply" }; }
});
assert.equal(applied, true, "production writes require explicit --apply");

console.log("Vote schema backfill CLI contract passed");
