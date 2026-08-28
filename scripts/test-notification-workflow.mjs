import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseWorkflow } from "../workflow-policy.mjs";
import {
  NOTIFICATION_WORKFLOW_PATH,
  validateNotificationWorkflow
} from "../notification-workflow-policy.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const workflow = parseWorkflow(await readFile(new URL(NOTIFICATION_WORKFLOW_PATH, repositoryRoot), "utf8"), NOTIFICATION_WORKFLOW_PATH);
assert.deepEqual(validateNotificationWorkflow(workflow), []);
const clone = () => structuredClone(workflow);
const reject = (mutate, label) => {
  const candidate = clone();
  mutate(candidate);
  assert.notDeepEqual(validateNotificationWorkflow(candidate), [], `${label} must be rejected`);
};

reject((value) => { value.jobs.exfiltrate = { "runs-on": "ubuntu-latest", steps: [{ run: "echo secret" }] }; }, "extra job");
reject((value) => { value.jobs.process.steps.push({ uses: "actions/upload-artifact@v4" }); }, "extra action");
reject((value) => { value.jobs.process.steps.push({ run: "env" }); }, "extra command");
reject((value) => { value.permissions.contents = "write"; }, "permission escalation");
reject((value) => { value.on.schedule[0].cron = "0 * * * *"; }, "wrong schedule");
reject((value) => { value.concurrency.group = "wrong"; }, "wrong concurrency");
reject((value) => { value.concurrency["cancel-in-progress"] = true; }, "cancelling concurrency");
reject((value) => { value.jobs.process.steps[1].with["node-version"] = "22"; }, "wrong runtime");
reject((value) => { value.jobs.process.steps[3].uses = "google-github-actions/auth@v2"; }, "wrong auth action");
reject((value) => { value.jobs.process.steps[3].with.credentials_json = "${{ secrets.WRONG }}"; }, "wrong service-account secret");
reject((value) => { value.jobs.process.steps[4].run = "node scripts/other.mjs"; }, "wrong processor command");
reject((value) => { value.jobs.process.steps[4].env.GCLOUD_PROJECT = "wrong"; }, "wrong project");
reject((value) => { value.jobs.process.steps[4].env.ANONCHAT_VAPID_PRIVATE_KEY = "${{ secrets.WRONG }}"; }, "wrong VAPID secret");
reject((value) => { value.jobs.process.steps[2].env = { ANONCHAT_VAPID_PRIVATE_KEY: "${{ secrets.ANONCHAT_VAPID_PRIVATE_KEY }}" }; }, "secret on install step");
reject((value) => { value.jobs.process.steps[4].if = "always()"; }, "conditional processor");
reject((value) => { value.jobs.process.steps[4]["continue-on-error"] = true; }, "nonblocking processor");
reject((value) => { value.jobs.process.timeout = 1; }, "unapproved job property");

console.log("Notification workflow policy passed");
