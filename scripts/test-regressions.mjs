import assert from "node:assert/strict";
import {
  messageRequestButtonAction,
  messageRequestButtonState,
  messageRequestDecision
} from "../message-request-policy.mjs";
import { resolveConnectionsTarget } from "../connections-target.mjs";

const me = "user-b";

assert.deepEqual(
  messageRequestDecision({ fromId: "user-a", toId: me, status: "declined" }, me),
  { action: "retry", otherId: "user-a" },
  "a recipient who declined can start a new request in the reverse direction"
);
assert.deepEqual(
  messageRequestDecision({ fromId: me, toId: "user-a", status: "declined" }, me),
  { action: "retry", otherId: "user-a" },
  "the original sender can retry a declined request"
);
assert.equal(
  messageRequestDecision({ fromId: me, toId: "user-a", status: "pending" }, me).action,
  "outgoing-pending",
  "an existing outgoing request does not write again"
);
assert.equal(
  messageRequestDecision({ fromId: "user-a", toId: me, status: "pending" }, me).action,
  "incoming-pending",
  "an incoming request directs the user to respond instead of writing"
);
assert.equal(
  messageRequestButtonAction({ fromId: "user-a", toId: me, status: "pending" }, me),
  "accept-incoming",
  "sending toward an existing incoming request accepts the mutual conversation"
);
assert.equal(
  messageRequestButtonAction({ fromId: me, toId: "user-a", status: "pending" }, me),
  "outgoing-pending",
  "the original sender still waits for the recipient"
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
  { targetUserId: "signed-in-user", canonicalSearch: "?uid=signed-in-user" },
  "another profile cannot expose its private follower/following graph"
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
await import("./test-payment-preparation-ui.mjs");
await import("./test-badge-policy.mjs");
