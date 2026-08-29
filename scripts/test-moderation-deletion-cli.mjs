import assert from "node:assert/strict";
import { fixedResultSummary, main, parseArguments, resolveProjectId } from "./moderation-deletion-processor.mjs";

assert.deepEqual(parseArguments([]), { dryRun: false });
assert.deepEqual(parseArguments(["--dry-run"]), { dryRun: true });
assert.throws(() => parseArguments(["--target", "private-id"]), /INVALID_ARGUMENT/);
assert.equal(resolveProjectId({ GCLOUD_PROJECT: "configured" }), "configured");
assert.equal(resolveProjectId({}), "anonchatlogin");

const result = { inspected: 2, processed: 1, failed: 0, skipped: 1, cleaned: 3 };
assert.equal(fixedResultSummary(result), "PROCESSOR_RESULT inspected=2 processed=1 failed=0 skipped=1 cleaned=3");

let closed = false;
let invocation;
await main(["--dry-run"], {
  env: { GCLOUD_PROJECT: "configured" },
  createRuntime: async () => ({ adapter: { production: true }, close: async () => { closed = true; } }),
  processor: async parameters => { invocation = parameters; return result; },
  ownerIdFactory: () => "worker"
});
assert.equal(invocation.adapter.production, true);
assert.equal(invocation.ownerId, "worker");
assert.equal(invocation.dryRun, true);
assert.equal(closed, true);

console.log("Moderation deletion direct CLI contract passed");
