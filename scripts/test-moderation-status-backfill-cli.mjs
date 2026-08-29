import assert from "node:assert/strict";
import {
  fixedResultSummary,
  main,
  parseArguments,
  resolveProjectId
} from "./backfill-moderation-status.mjs";

assert.deepEqual(parseArguments([]), { apply: false });
assert.deepEqual(parseArguments(["--apply"]), { apply: true });
assert.throws(() => parseArguments(["--dry-run"]), /INVALID_ARGUMENT/);
assert.throws(() => parseArguments(["--apply", "--target", "posts"]), /INVALID_ARGUMENT/);

assert.equal(resolveProjectId({ GCLOUD_PROJECT: "configured-gcloud" }), "configured-gcloud");
assert.equal(resolveProjectId({ GOOGLE_CLOUD_PROJECT: "configured-google" }), "configured-google");
assert.equal(
  resolveProjectId({ FIREBASE_CONFIG: JSON.stringify({ projectId: "configured-firebase" }) }),
  "configured-firebase"
);
assert.equal(resolveProjectId({ FIREBASE_CONFIG: "not-json" }), "anonchatlogin");
assert.equal(resolveProjectId({}), "anonchatlogin");

const dryRunResult = { mode: "dry-run", scanned: 9, eligible: 3, updated: 0, batches: 0 };
assert.equal(
  fixedResultSummary(dryRunResult),
  "BACKFILL_RESULT mode=dry-run scanned=9 eligible=3 updated=0 batches=0"
);

let selectedProject;
let invocation;
let closed = false;
const returned = await main([], {
  env: { GCLOUD_PROJECT: "configured-project" },
  createRuntime: async (projectId) => {
    selectedProject = projectId;
    return { adapter: { marker: "admin-adapter" }, close: async () => { closed = true; } };
  },
  runner: async (parameters) => {
    invocation = parameters;
    return dryRunResult;
  }
});
assert.equal(selectedProject, "configured-project");
assert.equal(invocation.adapter.marker, "admin-adapter");
assert.equal(invocation.apply, false, "the command is dry-run by default");
assert.equal(returned, dryRunResult);
assert.equal(closed, true);

const applyResult = { mode: "apply", scanned: 9, eligible: 3, updated: 3, batches: 1 };
let applyInvocation;
await main(["--apply"], {
  createRuntime: async () => ({ adapter: {}, close: async () => {} }),
  runner: async (parameters) => {
    applyInvocation = parameters;
    return applyResult;
  }
});
assert.equal(applyInvocation.apply, true, "writes require the explicit apply flag");

let closedAfterFailure = false;
await assert.rejects(main([], {
  createRuntime: async () => ({ adapter: {}, close: async () => { closedAfterFailure = true; } }),
  runner: async () => { throw new Error("TEST_FAILURE"); }
}), /TEST_FAILURE/);
assert.equal(closedAfterFailure, true);

console.log("Moderation status backfill CLI contract passed");
