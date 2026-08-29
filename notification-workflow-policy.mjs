export const NOTIFICATION_WORKFLOW_PATH = ".github/workflows/process-notifications.yml";

const CRON = "*/5 * * * *";
const SERVICE_ACCOUNT_SECRET = "${{ secrets.FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN }}";
const PRIVATE_KEY_SECRET = "${{ secrets.ANONCHAT_VAPID_PRIVATE_KEY }}";
const CREDENTIAL_PATH = "${{ steps.auth.outputs.credentials_file_path }}";
const sameKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
const exactObject = (value, expected) => sameKeys(value, Object.keys(expected))
  && Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
const stepSignature = (step) => typeof step?.uses === "string" && !Object.hasOwn(step, "run")
  ? `uses:${step.uses}`
  : typeof step?.run === "string" && !Object.hasOwn(step, "uses")
    ? `run:${step.run}`
    : "invalid";
const validateExactStep = (errors, step, expected, label) => {
  if (!sameKeys(step, Object.keys(expected))) errors.push(`${label} properties are not approved`);
  for (const [key, value] of Object.entries(expected)) {
    if (value && typeof value === "object") {
      if (!exactObject(step?.[key], value)) errors.push(`${label}.${key} is not exact`);
    } else if (step?.[key] !== value) errors.push(`${label}.${key} is not exact`);
  }
};

export const validateNotificationWorkflow = (workflow) => {
  const errors = [];
  if (!sameKeys(workflow, ["name", "on", "permissions", "concurrency", "jobs"])) errors.push("workflow properties are not approved");
  if (workflow?.name !== "Process AnonChat notifications") errors.push("workflow name is not exact");
  if (!sameKeys(workflow?.on, ["schedule", "workflow_dispatch"]) || workflow.on?.workflow_dispatch !== null
    || !Array.isArray(workflow.on?.schedule) || workflow.on.schedule.length !== 1
    || !exactObject(workflow.on.schedule[0], { cron: CRON })) errors.push("workflow triggers are not exact");
  if (!exactObject(workflow?.permissions, { contents: "read" })) errors.push("workflow permissions must be contents read only");
  if (!exactObject(workflow?.concurrency, { group: "anonchat-notification-delivery", "cancel-in-progress": false })) errors.push("workflow concurrency is not exact");
  if (!sameKeys(workflow?.jobs, ["process"])) errors.push("process must be the only job");
  const job = workflow?.jobs?.process ?? {};
  if (!sameKeys(job, ["runs-on", "steps"])) errors.push("job properties are not approved");
  if (job["runs-on"] !== "ubuntu-latest") errors.push("job runner is not exact");
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const expectedSignatures = [
    "uses:actions/checkout@v4",
    "uses:actions/setup-node@v4",
    "run:npm ci",
    "uses:google-github-actions/auth@v3",
    "run:npm run notification:process"
  ];
  if (steps.map(stepSignature).join("\u0000") !== expectedSignatures.join("\u0000")) errors.push("workflow steps are not exact");
  validateExactStep(errors, steps[0], { uses: "actions/checkout@v4" }, "checkout step");
  validateExactStep(errors, steps[1], { uses: "actions/setup-node@v4", with: { "node-version": "22" } }, "Node step");
  validateExactStep(errors, steps[2], { run: "npm ci" }, "install step");
  validateExactStep(errors, steps[3], { id: "auth", uses: "google-github-actions/auth@v3", with: { credentials_json: SERVICE_ACCOUNT_SECRET } }, "authentication step");
  validateExactStep(errors, steps[4], {
    run: "npm run notification:process",
    env: {
      GCLOUD_PROJECT: "anonchatlogin",
      GOOGLE_APPLICATION_CREDENTIALS: CREDENTIAL_PATH,
      ANONCHAT_VAPID_PRIVATE_KEY: PRIVATE_KEY_SECRET
    }
  }, "processor step");
  return errors;
};

export const notificationWorkflowPolicy = { CRON, SERVICE_ACCOUNT_SECRET, PRIVATE_KEY_SECRET, CREDENTIAL_PATH };
