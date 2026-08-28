import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DELETION_WORKFLOW_PATH,
  RULES_WORKFLOW_PATH,
  parseWorkflow,
  validateDeletionWorkflow,
  validatePackageScripts,
  validateRulesWorkflow
} from "../workflow-policy.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const readWorkflow = async (path) => parseWorkflow(await readFile(new URL(path, repositoryRoot), "utf8"), path);
const assertValid = (errors, label) => assert.deepEqual(errors, [], `${label}: ${errors.join("; ")}`);

const deletionWorkflow = await readWorkflow(DELETION_WORKFLOW_PATH);
const rulesWorkflow = await readWorkflow(RULES_WORKFLOW_PATH);
const packageJson = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));
assertValid(validateDeletionWorkflow(deletionWorkflow), "trusted deletion workflow");
assertValid(validateRulesWorkflow(rulesWorkflow), "Firestore rules CI workflow");
assertValid(validatePackageScripts(packageJson), "workflow package scripts");
assert.deepEqual(rulesWorkflow.on.pull_request.paths, [
  "firestore.rules",
  "firestore.indexes.json",
  "firebase.json",
  "package.json",
  "package-lock.json",
  ".github/workflows/firestore-rules-ci.yml",
  ".github/workflows/process-admin-deletions.yml",
  "scripts/**"
], "Firestore CI must run when the trusted deletion workflow changes");

const assertRejected = (validator, workflow, label) => assert.notDeepEqual(validator(workflow), [], `${label} must be rejected`);
const clone = (workflow) => structuredClone(workflow);

const deletionExtraJob = clone(deletionWorkflow);
deletionExtraJob.jobs.exfiltrate = { "runs-on": "ubuntu-latest", steps: [{ run: "echo credential" }] };
assertRejected(validateDeletionWorkflow, deletionExtraJob, "extra deletion job");

const deletionExtraUses = clone(deletionWorkflow);
deletionExtraUses.jobs.process.steps.push({ uses: "actions/upload-artifact@v4" });
assertRejected(validateDeletionWorkflow, deletionExtraUses, "extra deletion action");

const deletionExtraRun = clone(deletionWorkflow);
deletionExtraRun.jobs.process.steps.push({ run: "echo credential" });
assertRejected(validateDeletionWorkflow, deletionExtraRun, "extra deletion command");

const deletionWriteOverride = clone(deletionWorkflow);
deletionWriteOverride.jobs.process.permissions = { contents: "write" };
assertRejected(validateDeletionWorkflow, deletionWriteOverride, "deletion job permission escalation");

const rulesExtraJob = clone(rulesWorkflow);
rulesExtraJob.jobs.exfiltrate = { "runs-on": "ubuntu-latest", steps: [{ run: "echo credential" }] };
assertRejected(validateRulesWorkflow, rulesExtraJob, "extra rules job");

const rulesExtraUses = clone(rulesWorkflow);
rulesExtraUses.jobs.test.steps.push({ uses: "actions/upload-artifact@v4" });
assertRejected(validateRulesWorkflow, rulesExtraUses, "extra rules action");

const rulesExtraRun = clone(rulesWorkflow);
rulesExtraRun.jobs.test.steps.push({ run: "echo credential" });
assertRejected(validateRulesWorkflow, rulesExtraRun, "extra rules command");

const rulesWriteOverride = clone(rulesWorkflow);
rulesWriteOverride.jobs.test.permissions = { contents: "write" };
assertRejected(validateRulesWorkflow, rulesWriteOverride, "rules job permission escalation");

const wrongDeletionFixture = parseWorkflow(`
# cron: "*/5 * * * *"
# credentials_json: \${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}
on:
  schedule:
    - cron: "0 * * * *"
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: anonchat-account-deletions
  cancel-in-progress: false
jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - run: npm ci
      - id: auth
        uses: google-github-actions/auth@v3
        with:
          credentials_json: "\${{ secrets.WRONG_SECRET }}"
      - run: npm run admin-deletion:process
        env:
          GCLOUD_PROJECT: anonchatlogin
          GOOGLE_APPLICATION_CREDENTIALS: \${{ steps.auth.outputs.credentials_file_path }}
      - run: "# npm run admin-deletion:process \${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}"
`, "wrong deletion fixture");
assert.ok(validateDeletionWorkflow(wrongDeletionFixture).length > 0, "comments and unrelated steps must not satisfy deletion policy");

const wrongRulesFixture = parseWorkflow(`
# java-version: "21"
on:
  pull_request:
    paths:
      - firestore.rules
      - firestore.indexes.json
      - firebase.json
      - package.json
      - package-lock.json
      - .github/workflows/firestore-rules-ci.yml
      - scripts/**
  workflow_dispatch:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "17" }
      - run: npm ci
      - run: npm run test:workflow-policy
      - run: npm run test:firestore-ci
      - run: "# java-version: 21"
`, "wrong rules fixture");
assert.ok(validateRulesWorkflow(wrongRulesFixture).length > 0, "comments and unrelated steps must not satisfy rules policy");

console.log("Workflow policy passed");
