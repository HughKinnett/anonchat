import assert from "node:assert/strict";
import { typingExpiresAt, isTypingActive } from "../private-message-typing-policy.mjs";

assert.equal(typingExpiresAt(1000), 8000);
assert.equal(typingExpiresAt(1000, 3000), 4000);
assert.equal(isTypingActive({ expiresAt: 8000 }, 7999), true);
assert.equal(isTypingActive({ expiresAt: 8000 }, 8000), false);
assert.equal(isTypingActive({ expiresAt: 8000 }, 8001), false);
assert.equal(isTypingActive({}, 7999), false);
console.log("private message typing policy tests passed");
