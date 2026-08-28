import { PUSH_ALERT_MESSAGES } from "./push-client.mjs";

export function applyPushAlertState({ state, button, status }) {
  status.textContent = PUSH_ALERT_MESSAGES[state] || "";
  button.disabled = state === "enabling" || state === "unsupported";
  button.textContent = state === "enabled" ? "Phone alerts on" : "Enable phone alerts";
}
