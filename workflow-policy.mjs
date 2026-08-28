import { parseDocument } from "yaml";

export const DELETION_WORKFLOW_PATH = ".github/workflows/process-admin-deletions.yml";
export const RULES_WORKFLOW_PATH = ".github/workflows/firestore-rules-ci.yml";

const deletionCron = "*/5 * * * *";
const secretReference = "${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}";
const credentialPathReference = "${{ steps.auth.outputs.credentials_file_path }}";
const rulesPaths = [
  "firestore.rules",
  "firestore.indexes.json",
  "firebase.json",
  "package.json",
  "package-lock.json",
  ".github/workflows/firestore-rules-ci.yml",
  "scripts/**"
];
const firestoreCiCommand = "npm run test:rules && npm run test:activity-rules && npm run test:admin-deletion && npm run test:admin-deletion-firestore-integration && npm run test:admin-deletion-processor-policy && npm run test:admin-deletion-processor && npm run test:admin-deletion-indexes && npm run test:admin-deletion-cli && npm run test:auth-activity && npm test";

export const parseWorkflow = (source, label = "workflow") => {
  const document = parseDocument(source, { version: "1.2" });
  if (document.errors.length) throw new Error(`${label} YAML is invalid: ${document.errors[0].message}`);
  const workflow = document.toJS();
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) throw new Error(`${label} must be a YAML mapping`);
  return workflow;
};

const sameArray = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);
const sameKeys = (object, expected) => object && typeof object === "object" && sameArray(Object.keys(object).sort(), [...expected].sort());
const exactly = (errors, actual, expected, label) => {
  if (actual !== expected) errors.push(`${label} must be ${JSON.stringify(expected)}`);
};
const findSteps = (steps, key, value) => steps.filter((step) => step?.[key] === value);
const singleStep = (errors, steps, key, value, label) => {
  const matches = findSteps(steps, key, value);
  if (matches.length !== 1) errors.push(`${label} must appear exactly once`);
  return matches[0];
};
const workflowTriggers = (workflow) => workflow.on;
const workflowJob = (workflow, name, errors) => {
  const job = workflow.jobs?.[name];
  if (!job || typeof job !== "object") errors.push(`jobs.${name} must exist`);
  return job ?? {};
};
const jobSteps = (job, errors, label) => {
  if (!Array.isArray(job.steps)) {
    errors.push(`${label}.steps must be an array`);
    return [];
  }
  return job.steps;
};

export const validateDeletionWorkflow = (workflow) => {
  const errors = [];
  const triggers = workflowTriggers(workflow);
  if (!sameKeys(triggers, ["schedule", "workflow_dispatch"])) errors.push("deletion workflow triggers must be schedule and workflow_dispatch only");
  if (!sameArray(triggers?.schedule?.map((entry) => entry?.cron), [deletionCron])) errors.push(`deletion workflow schedule must be ${deletionCron}`);
  if (!workflow.permissions || Object.keys(workflow.permissions).length !== 1 || workflow.permissions.contents !== "read") errors.push("deletion workflow permissions must be contents: read only");
  if (workflow.concurrency?.group !== "anonchat-account-deletions" || workflow.concurrency?.["cancel-in-progress"] !== false) errors.push("deletion workflow concurrency must preserve every queued run");

  const job = workflowJob(workflow, "process", errors);
  exactly(errors, job["runs-on"], "ubuntu-latest", "deletion workflow runner");
  const steps = jobSteps(job, errors, "jobs.process");
  const node = singleStep(errors, steps, "uses", "actions/setup-node@v4", "Node setup");
  exactly(errors, String(node?.with?.["node-version"]), "20", "Node version");
  const install = singleStep(errors, steps, "run", "npm ci", "npm ci");
  void install;
  const auth = singleStep(errors, steps, "uses", "google-github-actions/auth@v3", "Google authentication");
  exactly(errors, auth?.id, "auth", "Google authentication step id");
  exactly(errors, auth?.with?.credentials_json, secretReference, "Google authentication secret");
  const processor = singleStep(errors, steps, "run", "npm run admin-deletion:process", "deletion processor command");
  exactly(errors, processor?.env?.GCLOUD_PROJECT, "anonchatlogin", "deletion processor project");
  exactly(errors, processor?.env?.GOOGLE_APPLICATION_CREDENTIALS, credentialPathReference, "deletion processor credential path");
  if (steps.some((step) => typeof step?.run === "string" && !["npm ci", "npm run admin-deletion:process"].includes(step.run))) errors.push("deletion workflow may not run logging or unrelated commands");
  return errors;
};

export const validateRulesWorkflow = (workflow) => {
  const errors = [];
  const triggers = workflowTriggers(workflow);
  if (!sameKeys(triggers, ["pull_request", "workflow_dispatch"])) errors.push("rules workflow triggers must be pull_request and workflow_dispatch only");
  if (!sameArray(triggers?.pull_request?.paths, rulesPaths)) errors.push("rules workflow pull request paths must cover the protected inputs exactly");
  const job = workflowJob(workflow, "test", errors);
  exactly(errors, job["runs-on"], "ubuntu-latest", "rules workflow runner");
  const steps = jobSteps(job, errors, "jobs.test");
  const node = singleStep(errors, steps, "uses", "actions/setup-node@v4", "rules Node setup");
  exactly(errors, String(node?.with?.["node-version"]), "20", "rules Node version");
  const java = singleStep(errors, steps, "uses", "actions/setup-java@v4", "Java setup");
  exactly(errors, String(java?.with?.["java-version"]), "21", "Java version");
  exactly(errors, java?.with?.distribution, "temurin", "Java distribution");
  singleStep(errors, steps, "run", "npm ci", "rules npm ci");
  singleStep(errors, steps, "run", "npm run test:workflow-policy", "workflow policy test command");
  singleStep(errors, steps, "run", "npm run test:firestore-ci", "Firestore CI test command");
  const unpinnedFirebaseCommands = ["npm install -g firebase-tools", "npm i -g firebase-tools", "npx firebase-tools", "npx --yes firebase-tools"];
  if (steps.some((step) => typeof step?.run === "string" && unpinnedFirebaseCommands.some((command) => step.run.includes(command)))) errors.push("rules workflow must use Firebase CLI from the lockfile");
  return errors;
};

export const validatePackageScripts = (packageJson) => {
  const errors = [];
  if (packageJson.devDependencies?.yaml !== "2.9.0") errors.push("yaml must be pinned to 2.9.0");
  if (packageJson.devDependencies?.["firebase-tools"] !== "13.35.1") errors.push("firebase-tools must remain pinned to 13.35.1");
  exactly(errors, packageJson.scripts?.["test:workflow-policy"], "node scripts/test-workflow-policy.mjs", "workflow policy package script");
  exactly(errors, packageJson.scripts?.["test:firestore-ci"], firestoreCiCommand, "Firestore CI package script");
  return errors;
};

export const workflowPolicy = { deletionCron, rulesPaths, firestoreCiCommand, secretReference, credentialPathReference };
