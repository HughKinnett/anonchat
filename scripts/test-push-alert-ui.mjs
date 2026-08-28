import assert from "node:assert/strict";
import { applyPushAlertState } from "../push-alert-ui.mjs";
import { PUSH_ALERT_MESSAGES } from "../push-client.mjs";

const button = { disabled: false, textContent: "" };
const status = { textContent: "" };
applyPushAlertState({ state: "enabling", button, status });
assert.equal(button.disabled, true);
assert.equal(status.textContent, PUSH_ALERT_MESSAGES.enabling);

applyPushAlertState({ state: "retry", button, status });
assert.equal(button.disabled, false, "readiness timeout exits the disabled enabling UI");
assert.equal(button.textContent, "Enable phone alerts");
assert.equal(status.textContent, PUSH_ALERT_MESSAGES.retry);

console.log("Push alert UI states passed");
