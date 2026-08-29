import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  DELETION_WORKFLOW_URL,
  DELETION_WORKFLOW_PATH,
  DEPLOY_WORKFLOW_PATH,
  MODERATION_WORKFLOW_PATH,
  RULES_WORKFLOW_PATH,
  parseWorkflow,
  validateDeletionWorkflow,
  validateDeployWorkflow,
  validateModerationWorkflow,
  validateHostingConfig,
  validatePackageScripts,
  validateRulesWorkflow,
  workflowPolicy
} from "../workflow-policy.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const require = createRequire(import.meta.url);
const { listFiles: listFirebaseHostingFiles } = require("firebase-tools/lib/listFiles.js");
const readWorkflow = async (path) => parseWorkflow(await readFile(new URL(path, repositoryRoot), "utf8"), path);
const assertValid = (errors, label) => assert.deepEqual(errors, [], `${label}: ${errors.join("; ")}`);
const assertRejected = (validator, workflow, label) => assert.notDeepEqual(validator(workflow), [], `${label} must be rejected`);
const clone = (workflow) => structuredClone(workflow);

const deletionWorkflow = await readWorkflow(DELETION_WORKFLOW_PATH);
const deployWorkflow = await readWorkflow(DEPLOY_WORKFLOW_PATH);
const rulesWorkflow = await readWorkflow(RULES_WORKFLOW_PATH);
const moderationWorkflow = await readWorkflow(MODERATION_WORKFLOW_PATH);
const packageJson = JSON.parse(await readFile(new URL("package.json", repositoryRoot), "utf8"));
const firebaseJson = JSON.parse(await readFile(new URL("firebase.json", repositoryRoot), "utf8"));
const adminHtml = await readFile(new URL("admin.html", repositoryRoot), "utf8");
assertValid(validateDeletionWorkflow(deletionWorkflow), "trusted deletion workflow");
assertValid(validateDeployWorkflow(deployWorkflow), "Firebase production deploy workflow");
assertValid(validateRulesWorkflow(rulesWorkflow), "Firestore rules CI workflow");
assertValid(validateModerationWorkflow(moderationWorkflow), "trusted moderation workflow");
assertValid(validatePackageScripts(packageJson), "workflow package scripts");
assertValid(validateHostingConfig(firebaseJson), "Firebase Hosting deployment boundary");
assert.equal(JSON.stringify(deployWorkflow).split(workflowPolicy.secretReference).length - 1, 1,
  "the deploy credential is referenced by the authentication action only");

const hostingFixtureRoot = await mkdtemp(join(tmpdir(), "anonchat-hosting-selection-"));
try {
  await mkdir(join(hostingFixtureRoot, "nested"));
  await mkdir(join(hostingFixtureRoot, ".well-known"));
  await Promise.all([
    writeFile(join(hostingFixtureRoot, "index.html"), "safe"),
    writeFile(join(hostingFixtureRoot, ".well-known", "assetlinks.json"), "safe"),
    writeFile(join(hostingFixtureRoot, "gha-creds-root.json"), "secret"),
    writeFile(join(hostingFixtureRoot, "nested", "gha-creds-nested.json"), "secret")
  ]);
  assert.deepEqual(listFirebaseHostingFiles(hostingFixtureRoot, firebaseJson.hosting.ignore).sort(), [
    ".well-known/assetlinks.json",
    "index.html"
  ], "the locked Firebase Hosting selector excludes root and nested auth credential files");
} finally {
  await rm(hostingFixtureRoot, { recursive: true, force: true });
}
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
  "test:legal-signup",
  "test:moderation-client",
  "test:content-writer",
  "test:moderation-backfill",
  "test:moderation-indexes",
  "test:profile-render",
  "test:moderation-policy",
  "test:community-lifecycle",
  "test:timeline-query-compatibility",
  "test:viewer-block-policy",
  "test:viewer-block-surfaces",
  "test:timeline-query-rules",
  "test:push-rules",
  "test:push",
  "test:self-delete",
  "test:legacy-migration",
  "test:admin-dashboard",
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

const broadDotfileIgnore = structuredClone(firebaseJson);
broadDotfileIgnore.hosting.ignore.push("**/.*");
assert.notDeepEqual(validateHostingConfig(broadDotfileIgnore), [], "broad dotfile ignore must be rejected because it deploy-blocks .well-known");
const exposedWorktree = structuredClone(firebaseJson);
exposedWorktree.hosting.ignore = exposedWorktree.hosting.ignore.filter((path) => path !== ".worktrees/**");
assert.notDeepEqual(validateHostingConfig(exposedWorktree), [], "worktrees must never deploy");
const hiddenWellKnown = structuredClone(firebaseJson);
hiddenWellKnown.hosting.ignore.push(".well-known/**");
assert.notDeepEqual(validateHostingConfig(hiddenWellKnown), [], ".well-known must remain deployable for Android asset links");
for (const credentialPattern of [
  "gha-creds-*.json", "**/gha-creds-*.json",
  "**/service-account*.json", "**/serviceAccount*.json", "**/*.pem", "**/*.key"
]) {
  const exposedCredential = structuredClone(firebaseJson);
  exposedCredential.hosting.ignore = exposedCredential.hosting.ignore.filter((path) => path !== credentialPattern);
  assert.notDeepEqual(validateHostingConfig(exposedCredential), [], `${credentialPattern} must block generated credential files`);
}

const deletionExtraJob = clone(deletionWorkflow);
deletionExtraJob.jobs.exfiltrate = { "runs-on": "ubuntu-latest", steps: [{ run: "echo credential" }] };
assertRejected(validateDeletionWorkflow, deletionExtraJob, "extra deletion job");

const moderationExtraRun = clone(moderationWorkflow);
moderationExtraRun.jobs.process.steps.push({ run: "echo credential" });
assertRejected(validateModerationWorkflow, moderationExtraRun, "extra moderation command");
const moderationWrongCron = clone(moderationWorkflow);
moderationWrongCron.on.schedule[0].cron = "0 * * * *";
assertRejected(validateModerationWorkflow, moderationWrongCron, "wrong moderation schedule");
const moderationWrongSecret = clone(moderationWorkflow);
moderationWrongSecret.jobs.process.steps[3].with.credentials_json = "${{ secrets.WRONG_SECRET }}";
assertRejected(validateModerationWorkflow, moderationWrongSecret, "wrong moderation secret");
const moderationScheduleExtraKey = clone(moderationWorkflow);
moderationScheduleExtraKey.on.schedule[0].timezone = "UTC";
assertRejected(validateModerationWorkflow, moderationScheduleExtraKey, "moderation schedule extra key");
for (const [script, replacement] of [["moderation:process", "node scripts/other.mjs"], ["test:moderation-processor", "node arbitrary.mjs"], ["test:moderation-firestore-integration", "node arbitrary.mjs"]]) {
  const tampered = structuredClone(packageJson); tampered.scripts[script] = replacement;
  assert.notDeepEqual(validatePackageScripts(tampered), [], `${script} must be pinned`);
}

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

const deployWrongBranch = clone(deployWorkflow);
deployWrongBranch.on.push.branches = ["release"];
assertRejected(validateDeployWorkflow, deployWrongBranch, "deploy push outside main");

const deployWithoutDispatch = clone(deployWorkflow);
delete deployWithoutDispatch.on.workflow_dispatch;
assertRejected(validateDeployWorkflow, deployWithoutDispatch, "deploy without manual dispatch");

const deployWithoutIndexes = clone(deployWorkflow);
deployWithoutIndexes.jobs.deploy.steps = deployWithoutIndexes.jobs.deploy.steps.filter((step) => step.name !== "Ensure required Firestore indexes");
assertRejected(validateDeployWorkflow, deployWithoutIndexes, "deploy without Firestore indexes");

const deployWaitAfterProcessor = clone(deployWorkflow);
const waitStep = deployWaitAfterProcessor.jobs.deploy.steps.splice(6, 1)[0];
deployWaitAfterProcessor.jobs.deploy.steps.splice(8, 0, waitStep);
assertRejected(validateDeployWorkflow, deployWaitAfterProcessor, "index wait after processor");

const deployUnboundedIndexWait = clone(deployWorkflow);
delete deployUnboundedIndexWait.jobs.deploy.steps.find((step) => step.name === "Wait for required Firestore indexes")?.["timeout-minutes"];
assertRejected(validateDeployWorkflow, deployUnboundedIndexWait, "unbounded Firestore index wait");

const deployRulesBeforeGate = clone(deployWorkflow);
const rulesStep = deployRulesBeforeGate.jobs.deploy.steps.splice(9, 1)[0];
deployRulesBeforeGate.jobs.deploy.steps.splice(6, 0, rulesStep);
assertRejected(validateDeployWorkflow, deployRulesBeforeGate, "rules exposed before rollout gates");

const deployHostingBeforeGate = clone(deployWorkflow);
const hostingStep = deployHostingBeforeGate.jobs.deploy.steps.splice(10, 1)[0];
deployHostingBeforeGate.jobs.deploy.steps.splice(6, 0, hostingStep);
assertRejected(validateDeployWorkflow, deployHostingBeforeGate, "Hosting exposed before rollout gates");

const deployCredentialLogging = clone(deployWorkflow);
deployCredentialLogging.jobs.deploy.steps.push({ run: "printenv GOOGLE_APPLICATION_CREDENTIALS" });
assertRejected(validateDeployWorkflow, deployCredentialLogging, "credential logging command");

const deploySecretEnvironment = clone(deployWorkflow);
deploySecretEnvironment.jobs.deploy.env = { CREDENTIALS: "${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}" };
assertRejected(validateDeployWorkflow, deploySecretEnvironment, "job-level deploy credentials");

const deployWithoutCredentialFile = clone(deployWorkflow);
deployWithoutCredentialFile.jobs.deploy.steps.find((step) => step.id === "auth").with.create_credentials_file = false;
assertRejected(validateDeployWorkflow, deployWithoutCredentialFile, "deploy without ADC credential file");

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
        with: { node-version: "22" }
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
        with: { node-version: "22" }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: "17" }
      - run: npm ci
      - run: npm run test:workflow-policy
      - run: npm run test:firestore-ci
      - run: "# java-version: 21"
`, "wrong rules fixture");
assert.ok(validateRulesWorkflow(wrongRulesFixture).length > 0, "comments and unrelated steps must not satisfy rules policy");

console.log("Workflow policy passed");
