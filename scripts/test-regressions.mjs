import assert from "node:assert/strict";
import { messageRequestDecision } from "../message-request-policy.mjs";
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
  messageRequestDecision({ fromId: "user-a", toId: "user-c", status: "declined" }, me).action,
  "invalid",
  "a non-participant cannot retry another pair's request"
);

assert.deepEqual(
  resolveConnectionsTarget("?uid=profile-owner", "signed-in-user"),
  { targetUserId: "profile-owner", canonicalSearch: "?uid=profile-owner" },
  "an explicit profile target is preserved"
);
assert.deepEqual(
  resolveConnectionsTarget("", "signed-in-user"),
  { targetUserId: "signed-in-user", canonicalSearch: "?uid=signed-in-user" },
  "the connections page defaults directly to the signed-in user"
);

console.log("message request and connections regressions passed");
