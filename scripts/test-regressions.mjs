import assert from "node:assert/strict";
import { messageRequestButtonState, messageRequestDecision } from "../message-request-policy.mjs";
import { resolveConnectionsTarget } from "../connections-target.mjs";

const me = "signed-in-user";

assert.deepEqual(
  messageRequestButtonState(null, me),
  { action: "create", label: "Send request", disabled: false, hint: "" },
  "a user with no request can send one"
);
assert.deepEqual(
  messageRequestButtonState({ fromId: me, toId: "user-a", status: "pending" }, me),
  { action: "outgoing-pending", label: "Request sent", disabled: true, hint: "Request sent. Waiting for this user to accept or decline." },
  "an outgoing request is visibly pending instead of appearing to do nothing"
);
assert.deepEqual(
  messageRequestButtonState({ fromId: "user-a", toId: me, status: "pending" }, me),
  { action: "accept-incoming", label: "Accept request", disabled: false, hint: "This user already requested you. Accept to start messaging." },
  "an incoming request turns the primary action into an explicit accept button"
);
assert.equal(
  messageRequestDecision({ fromId: "user-a", toId: "user-c", status: "declined" }, me).action,
  "invalid",
  "a non-participant cannot retry another pair's request"
);

assert.deepEqual(
  resolveConnectionsTarget("?uid=profile-owner", "signed-in-user"),
  { targetUserId: "profile-owner", canonicalSearch: "?uid=profile-owner" },
  "the connections page preserves another profile target so that profile's privacy setting can be enforced"
);
assert.deepEqual(
  resolveConnectionsTarget("", "signed-in-user"),
  { targetUserId: "signed-in-user", canonicalSearch: "?uid=signed-in-user" },
  "the connections page defaults directly to the signed-in user"
);

console.log("message request and connections regressions passed");

await import("./test-timeline-moderation-ui.mjs");
await import("./test-timeline-interaction-consistency.mjs");
await import("./test-premium-policy.mjs");
await import("./test-comment-surface-regression.mjs");
await import("./test-interaction-details.mjs");
await import("./test-follow-privacy-surface.mjs");
