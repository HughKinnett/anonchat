import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import {
  DELETION_WORKFLOW_URL,
  DELETION_WORKFLOW_PATH,
  DEPLOY_WORKFLOW_PATH,
  RULES_WORKFLOW_PATH,
  parseWorkflow,
  validateDeletionWorkflow,
  validateDeployWorkflow,
  validatePackageScripts,
  validateRulesWorkflow
} from "../workflow-policy.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const readWorkflow = async (path) => parseWorkflow(await readFile(new URL(path, repositoryRoot), "utf8"), path);
const assertValid = (errors, label) => assert.deepEqual(errors, [], `${label}: ${errors.join("; ")}`);
const assertRejected = (validator, workflow, label) => assert.notDeepEqual(validator(workflow), [], `${label} must be rejected`);
const clone = (workflow) => structuredClone(workflow);

const deletionWorkflow = await readWorkflow(DELETION_WORKFLOW_PATH);
const deployWorkflow = await readWorkflow(DEPLOY_WORKFLOW_PATH);
const rulesWorkflow = await readWorkflow(RULES_WORKFLOW_PATH);
const packageJson = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));
const adminHtml = await readFile(new URL("admin.html", repositoryRoot), "utf8");
assertValid(validateDeletionWorkflow(deletionWorkflow), "trusted deletion workflow");
await assert.rejects(access(new URL(".github/workflows/process-moderation-deletions.yml", repositoryRoot)),
  "the duplicate five-minute moderation schedule must be removed");
assertValid(validateDeployWorkflow(deployWorkflow), "Firebase production deploy workflow");
assertValid(validateRulesWorkflow(rulesWorkflow), "Firestore rules CI workflow");
assertValid(validatePackageScripts(packageJson), "workflow package scripts");
assert.deepEqual(rulesWorkflow.on.pull_request.paths, [
  "firestore.rules",
  "firestore.indexes.json",
  "firebase.json",
  "package.json",
  "package-lock.json",
  ".github/workflows/**",
  "*.js",
  "*.mjs",
  "*.html",
  "*.css",
  "*.webmanifest",
  "scripts/**"
], "release CI must run for workflows and every root client/policy surface");

for (const requiredPath of rulesWorkflow.on.pull_request.paths) {
  const missingPath = clone(rulesWorkflow);
  missingPath.on.pull_request.paths = missingPath.on.pull_request.paths.filter((path) => path !== requiredPath);
  assertRejected(validateRulesWorkflow, missingPath, `missing required PR path ${requiredPath}`);
}

const changedWorkflowPolicyPath = clone(rulesWorkflow);
changedWorkflowPolicyPath.on.pull_request.paths[changedWorkflowPolicyPath.on.pull_request.paths.indexOf("*.mjs")] = "notification-*.mjs";
assertRejected(validateRulesWorkflow, changedWorkflowPolicyPath, "narrowed root policy PR coverage");

for (const requiredSuite of [
  "test:push-rules",
  "test:push",
  "test:self-delete",
  "test:legacy-migration",
  "test:admin-dashboard",
  "test:moderation-policy",
  "test:moderation-rules",
  "test:admin-moderation",
  "test:moderation-deletion",
  "test:vote-schema",
  "test:production-migrations-cli",
  "test:deletion-processors-cli",
  "test:auth-activity"
]) {
  const missingSuite = structuredClone(packageJson);
  missingSuite.scripts["test:firestore-ci"] = missingSuite.scripts["test:firestore-ci"]
    .split(" && ")
    .filter((command) => command !== `npm run ${requiredSuite}`)
    .join(" && ");
  assert.notDeepEqual(validatePackageScripts(missingSuite), [], `removing ${requiredSuite} from release CI must be rejected`);
}

const missingServiceWorkerSuite = structuredClone(packageJson);
missingServiceWorkerSuite.scripts["test:notification"] = missingServiceWorkerSuite.scripts["test:notification"].replace(" && node scripts/test-push-service-worker.mjs", "");
assert.notDeepEqual(validatePackageScripts(missingServiceWorkerSuite), [], "removing the service-worker test from notification CI must be rejected");

const changedServiceWorkerSuite = structuredClone(packageJson);
changedServiceWorkerSuite.scripts["test:notification"] = changedServiceWorkerSuite.scripts["test:notification"].replace("test-push-service-worker.mjs", "test-push-client.mjs");
assert.notDeepEqual(validatePackageScripts(changedServiceWorkerSuite), [], "changing the service-worker test in notification CI must be rejected");

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

const changedModerationAggregate = clone(packageJson);
changedModerationAggregate.scripts["test:moderation-deletion"] = changedModerationAggregate.scripts["test:moderation-deletion"]
  .replace(" && npm run test:moderation-deletion-firestore-integration", "");
assert.notDeepEqual(validatePackageScripts(changedModerationAggregate), [],
  "moderation deletion integration cannot leave its package aggregate");

const changedDeletionProcessorAggregate = clone(packageJson);
changedDeletionProcessorAggregate.scripts["deletion-processors:process"] = "npm run admin-deletion:process";
assert.notDeepEqual(validatePackageScripts(changedDeletionProcessorAggregate), [],
  "the hosted five-minute command must run both deletion processors");

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

const deletionInstallSecretEnv = clone(deletionWorkflow);
deletionInstallSecretEnv.jobs.process.steps[2].env = { FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN: "${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}" };
assertRejected(validateDeletionWorkflow, deletionInstallSecretEnv, "secret-bearing environment on npm ci");

const deletionWorkflowEnv = clone(deletionWorkflow);
deletionWorkflowEnv.env = { FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN: "${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}" };
assertRejected(validateDeletionWorkflow, deletionWorkflowEnv, "deletion workflow environment");

const deletionJobEnv = clone(deletionWorkflow);
deletionJobEnv.jobs.process.env = { FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN: "${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}" };
assertRejected(validateDeletionWorkflow, deletionJobEnv, "deletion job environment");

const rulesWorkflowEnv = clone(rulesWorkflow);
rulesWorkflowEnv.env = { FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN: "${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}" };
assertRejected(validateRulesWorkflow, rulesWorkflowEnv, "rules workflow environment");

const rulesJobEnv = clone(rulesWorkflow);
rulesJobEnv.jobs.test.env = { FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN: "${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}" };
assertRejected(validateRulesWorkflow, rulesJobEnv, "rules job environment");

const rulesTestConditional = clone(rulesWorkflow);
rulesTestConditional.jobs.test.steps[5].if = false;
assertRejected(validateRulesWorkflow, rulesTestConditional, "conditional Firestore CI test command");

const rulesTestNonBlocking = clone(rulesWorkflow);
rulesTestNonBlocking.jobs.test.steps[5]["continue-on-error"] = true;
assertRejected(validateRulesWorkflow, rulesTestNonBlocking, "non-blocking Firestore CI test command");

const rulesTestAlternateShell = clone(rulesWorkflow);
rulesTestAlternateShell.jobs.test.steps[5].shell = "sh";
assertRejected(validateRulesWorkflow, rulesTestAlternateShell, "alternate-shell Firestore CI test command");

const rulesTestTimeout = clone(rulesWorkflow);
rulesTestTimeout.jobs.test.steps[5]["timeout-minutes"] = 1;
assertRejected(validateRulesWorkflow, rulesTestTimeout, "time-limited Firestore CI test command");

const deletionProcessorConditional = clone(deletionWorkflow);
deletionProcessorConditional.jobs.process.steps[4].if = false;
assertRejected(validateDeletionWorkflow, deletionProcessorConditional, "conditional deletion processor command");

const deployWithoutIndexes = clone(deployWorkflow);
deployWithoutIndexes.jobs.deploy.steps.at(-1).run =
  deployWithoutIndexes.jobs.deploy.steps.at(-1).run.replace("firestore:indexes,", "");
assertRejected(validateDeployWorkflow, deployWithoutIndexes, "deploy without Firestore indexes");

const deployWithoutMigration = clone(deployWorkflow);
deployWithoutMigration.jobs.deploy.steps.splice(4, 1);
assertRejected(validateDeployWorkflow, deployWithoutMigration, "deploy without production migrations");

const deployMigrationAfterRules = clone(deployWorkflow);
[deployMigrationAfterRules.jobs.deploy.steps[4], deployMigrationAfterRules.jobs.deploy.steps[5]] =
  [deployMigrationAfterRules.jobs.deploy.steps[5], deployMigrationAfterRules.jobs.deploy.steps[4]];
assertRejected(validateDeployWorkflow, deployMigrationAfterRules, "deploy migrations after strict rules");

const deployMigrationNonBlocking = clone(deployWorkflow);
deployMigrationNonBlocking.jobs.deploy.steps[4]["continue-on-error"] = true;
assertRejected(validateDeployWorkflow, deployMigrationNonBlocking, "non-blocking production migrations");

const deployExtraCommand = clone(deployWorkflow);
deployExtraCommand.jobs.deploy.steps.push({ run: "env" });
assertRejected(validateDeployWorkflow, deployExtraCommand, "extra deploy command");

const recoveryHref = adminHtml.match(/<a[^>]+href="([^"]+)"[^>]*>Open recovery page<\/a>/)?.[1];
assert.equal(recoveryHref, DELETION_WORKFLOW_URL,
  "the operator recovery control opens the exact trusted deletion workflow");

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
      - run: npm run deletion-processors:process
        env:
          GCLOUD_PROJECT: anonchatlogin
          GOOGLE_APPLICATION_CREDENTIALS: \${{ steps.auth.outputs.credentials_file_path }}
      - run: "# npm run deletion-processors:process \${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}"
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
