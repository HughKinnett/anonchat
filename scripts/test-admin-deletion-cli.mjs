import assert from "node:assert/strict";
import {
  fixedResultSummary,
  main,
  parseArguments,
  resolveProjectId
} from "./admin-deletion-processor.mjs";

assert.deepEqual(parseArguments([]), { dryRun: false });
assert.deepEqual(parseArguments(["--dry-run"]), { dryRun: true });
assert.throws(() => parseArguments(["--target", "private-uid"]), /INVALID_ARGUMENT/);

assert.equal(resolveProjectId({ GCLOUD_PROJECT: "configured-gcloud" }), "configured-gcloud");
assert.equal(resolveProjectId({ GOOGLE_CLOUD_PROJECT: "configured-google" }), "configured-google");
assert.equal(resolveProjectId({ FIREBASE_CONFIG: JSON.stringify({ projectId: "configured-firebase" }) }), "configured-firebase");
assert.equal(resolveProjectId({ FIREBASE_CONFIG: "not-json" }), "anonchatlogin");
assert.equal(resolveProjectId({}), "anonchatlogin");

const result = { inspected: 12, processed: 0, failed: 0, skipped: 0, purged: 0 };
assert.equal(
  fixedResultSummary(result),
  "PROCESSOR_RESULT inspected=12 processed=0 failed=0 skipped=0 purged=0"
);

let selectedProject;
let closed = false;
let invocation;
const returned = await main(["--dry-run"], {
  env: { GCLOUD_PROJECT: "configured-project" },
  createRuntime: async (projectId) => {
    selectedProject = projectId;
    return { adapter: { marker: "production-adapter-slot" }, close: async () => { closed = true; } };
  },
  processor: async (parameters) => {
    invocation = parameters;
    return result;
  },
  ownerIdFactory: () => "fixed-owner"
});
assert.equal(selectedProject, "configured-project");
assert.equal(invocation.adapter.marker, "production-adapter-slot");
assert.equal(invocation.ownerId, "fixed-owner");
assert.equal(invocation.dryRun, true);
assert.deepEqual(returned, result);
assert.equal(closed, true);

console.log("Administrator deletion direct CLI contract passed");
