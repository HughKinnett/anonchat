import assert from "node:assert/strict";
import { canCreateMessageRequest } from "../private-message-request-policy.mjs";

assert.equal(canCreateMessageRequest({ mode: "everyone", followsRecipient: false, blocked: false, alreadyAccepted: false }), true);
assert.equal(canCreateMessageRequest({ mode: "people-i-follow", followsRecipient: true, blocked: false, alreadyAccepted: false }), true);
assert.equal(canCreateMessageRequest({ mode: "people-i-follow", followsRecipient: false, blocked: false, alreadyAccepted: false }), false);
assert.equal(canCreateMessageRequest({ mode: "none", followsRecipient: true, blocked: false, alreadyAccepted: false }), false);
assert.equal(canCreateMessageRequest({ mode: "none", followsRecipient: false, blocked: false, alreadyAccepted: true }), true);
assert.equal(canCreateMessageRequest({ mode: "everyone", followsRecipient: true, blocked: true, alreadyAccepted: false }), false);
console.log("private message request policy tests passed");
