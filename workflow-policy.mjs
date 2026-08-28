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
  ".github/workflows/process-admin-deletions.yml",
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
const hasReadOnlyPermissions = (permissions) => sameKeys(permissions, ["contents"]) && permissions.contents === "read";
const hasExactValues = (object, expected) => sameKeys(object, Object.keys(expected)) && Object.entries(expected).every(([key, value]) => object[key] === value);
const exactly = (errors, actual, expected, label) => {
  if (actual !== expected) errors.push(`${label} must be ${JSON.stringify(expected)}`);
};
const exactlyKeys = (errors, object, expected, label) => {
  if (!sameKeys(object, expected)) errors.push(`${label} keys must be exactly ${expected.join(", ")}`);
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
const stepSignature = (step) => {
  if (typeof step?.uses === "string" && !Object.hasOwn(step, "run")) return `uses:${step.uses}`;
  if (typeof step?.run === "string" && !Object.hasOwn(step, "uses")) return `run:${step.run}`;
  return "invalid";
};
const exactlyOrderedSteps = (errors, steps, expected, label) => {
  if (!sameArray(steps.map(stepSignature), expected)) errors.push(`${label} must use the approved steps in order only`);
};
const effectiveReadOnlyPermissions = (errors, workflow, job, label) => {
  const effective = job.permissions ?? workflow.permissions;
  if (!hasReadOnlyPermissions(effective)) errors.push(`${label} effective permissions must be contents: read only`);
  if (job.permissions && !hasReadOnlyPermissions(job.permissions)) errors.push(`${label} job permissions may not escalate or add scopes`);
};
const validateStep = (errors, step, expected, label) => {
  exactlyKeys(errors, step, Object.keys(expected), label);
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === "object") {
      if (!hasExactValues(step?.[key], value)) errors.push(`${label}.${key} must contain only approved values`);
    } else exactly(errors, step?.[key], value, `${label}.${key}`);
  }
};

export const validateDeletionWorkflow = (workflow) => {
  const errors = [];
  exactlyKeys(errors, workflow, ["name", "on", "permissions", "concurrency", "jobs"], "deletion workflow");
  exactly(errors, workflow.name, "Process administrator account deletions", "deletion workflow name");
  const triggers = workflowTriggers(workflow);
  if (!sameKeys(triggers, ["schedule", "workflow_dispatch"])) errors.push("deletion workflow triggers must be schedule and workflow_dispatch only");
  exactly(errors, triggers?.workflow_dispatch, null, "deletion workflow dispatch trigger");
  if (!sameArray(triggers?.schedule, triggers?.schedule?.filter((entry) => hasExactValues(entry, { cron: deletionCron })))) errors.push("deletion workflow schedule entries must contain the approved cron only");
  if (!sameArray(triggers?.schedule?.map((entry) => entry?.cron), [deletionCron])) errors.push(`deletion workflow schedule must be ${deletionCron}`);
  if (!hasReadOnlyPermissions(workflow.permissions)) errors.push("deletion workflow permissions must be contents: read only");
  exactlyKeys(errors, workflow.concurrency, ["group", "cancel-in-progress"], "deletion workflow concurrency");
  if (workflow.concurrency?.group !== "anonchat-account-deletions" || workflow.concurrency?.["cancel-in-progress"] !== false) errors.push("deletion workflow concurrency must preserve every queued run");

  const job = workflowJob(workflow, "process", errors);
  if (!sameKeys(workflow.jobs, ["process"])) errors.push("deletion workflow must contain the process job only");
  exactlyKeys(errors, job, ["runs-on", "steps"], "deletion process job");
  effectiveReadOnlyPermissions(errors, workflow, job, "deletion workflow");
  exactly(errors, job["runs-on"], "ubuntu-latest", "deletion workflow runner");
  const steps = jobSteps(job, errors, "jobs.process");
  exactlyOrderedSteps(errors, steps, ["uses:actions/checkout@v4", "uses:actions/setup-node@v4", "run:npm ci", "uses:google-github-actions/auth@v3", "run:npm run admin-deletion:process"], "deletion workflow steps");
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
  validateStep(errors, steps[0], { uses: "actions/checkout@v4" }, "deletion checkout step");
  validateStep(errors, node, { uses: "actions/setup-node@v4", with: { "node-version": "20" } }, "deletion Node step");
  validateStep(errors, install, { run: "npm ci" }, "deletion install step");
  validateStep(errors, auth, { id: "auth", uses: "google-github-actions/auth@v3", with: { credentials_json: secretReference } }, "deletion authentication step");
  validateStep(errors, processor, { run: "npm run admin-deletion:process", env: { GCLOUD_PROJECT: "anonchatlogin", GOOGLE_APPLICATION_CREDENTIALS: credentialPathReference } }, "deletion processor step");
  if (steps.some((step) => typeof step?.run === "string" && !["npm ci", "npm run admin-deletion:process"].includes(step.run))) errors.push("deletion workflow may not run logging or unrelated commands");
  return errors;
};

export const validateRulesWorkflow = (workflow) => {
  const errors = [];
  exactlyKeys(errors, workflow, ["name", "on", "permissions", "jobs"], "rules workflow");
  exactly(errors, workflow.name, "Firestore rules CI", "rules workflow name");
  const triggers = workflowTriggers(workflow);
  if (!sameKeys(triggers, ["pull_request", "workflow_dispatch"])) errors.push("rules workflow triggers must be pull_request and workflow_dispatch only");
  exactly(errors, triggers?.workflow_dispatch, null, "rules workflow dispatch trigger");
  exactlyKeys(errors, triggers?.pull_request, ["paths"], "rules workflow pull request trigger");
  if (!sameArray(triggers?.pull_request?.paths, rulesPaths)) errors.push("rules workflow pull request paths must cover the protected inputs exactly");
  if (!hasReadOnlyPermissions(workflow.permissions)) errors.push("rules workflow permissions must be contents: read only");
  const job = workflowJob(workflow, "test", errors);
  if (!sameKeys(workflow.jobs, ["test"])) errors.push("rules workflow must contain the test job only");
  exactlyKeys(errors, job, ["runs-on", "steps"], "rules test job");
  effectiveReadOnlyPermissions(errors, workflow, job, "rules workflow");
  exactly(errors, job["runs-on"], "ubuntu-latest", "rules workflow runner");
  const steps = jobSteps(job, errors, "jobs.test");
  exactlyOrderedSteps(errors, steps, ["uses:actions/checkout@v4", "uses:actions/setup-node@v4", "uses:actions/setup-java@v4", "run:npm ci", "run:npm run test:workflow-policy", "run:npm run test:firestore-ci"], "rules workflow steps");
  const node = singleStep(errors, steps, "uses", "actions/setup-node@v4", "rules Node setup");
  exactly(errors, String(node?.with?.["node-version"]), "20", "rules Node version");
  const java = singleStep(errors, steps, "uses", "actions/setup-java@v4", "Java setup");
  exactly(errors, String(java?.with?.["java-version"]), "21", "Java version");
  exactly(errors, java?.with?.distribution, "temurin", "Java distribution");
  singleStep(errors, steps, "run", "npm ci", "rules npm ci");
  singleStep(errors, steps, "run", "npm run test:workflow-policy", "workflow policy test command");
  singleStep(errors, steps, "run", "npm run test:firestore-ci", "Firestore CI test command");
  validateStep(errors, steps[0], { uses: "actions/checkout@v4" }, "rules checkout step");
  validateStep(errors, node, { uses: "actions/setup-node@v4", with: { "node-version": "20" } }, "rules Node step");
  validateStep(errors, java, { uses: "actions/setup-java@v4", with: { distribution: "temurin", "java-version": "21" } }, "rules Java step");
  validateStep(errors, steps[3], { run: "npm ci" }, "rules install step");
  validateStep(errors, steps[4], { run: "npm run test:workflow-policy" }, "rules policy test step");
  validateStep(errors, steps[5], { run: "npm run test:firestore-ci" }, "rules Firestore test step");
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
