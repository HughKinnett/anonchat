import assert from "node:assert/strict";
import { canUnsendMessage, isMessageVisibleToUser } from "../private-message-visibility-policy.mjs";

assert.equal(canUnsendMessage({ currentUid: "alice", senderId: "alice", unsentAt: null }), true);
assert.equal(canUnsendMessage({ currentUid: "bob", senderId: "alice", unsentAt: null }), false);
assert.equal(canUnsendMessage({ currentUid: "alice", senderId: "alice", unsentAt: 123 }), false);
assert.equal(isMessageVisibleToUser({ hiddenFor: [], uid: "alice", unsentAt: null }), true);
assert.equal(isMessageVisibleToUser({ hiddenFor: ["alice"], uid: "alice", unsentAt: null }), false);
assert.equal(isMessageVisibleToUser({ hiddenFor: ["alice"], uid: "bob", unsentAt: null }), true);
assert.equal(isMessageVisibleToUser({ hiddenFor: [], uid: "alice", unsentAt: 123 }), true);
console.log("private message visibility policy tests passed");
