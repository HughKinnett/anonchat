import assert from "node:assert/strict";
import { MESSAGE_REACTIONS, normalizeMessageReaction, nextMessageReaction } from "../private-message-reaction-policy.mjs";

assert.deepEqual(MESSAGE_REACTIONS, ["👍", "❤️", "😂", "😮", "😢", "😡", "🖕"]);
assert.equal(normalizeMessageReaction("❤️"), "❤️");
assert.equal(normalizeMessageReaction("🔥"), null);
assert.equal(nextMessageReaction(null, "❤️"), "❤️");
assert.equal(nextMessageReaction("❤️", "❤️"), null);
assert.equal(nextMessageReaction("❤️", "😂"), "😂");
assert.throws(() => nextMessageReaction(null, "🔥"), /Unsupported reaction/);
console.log("private message reaction policy tests passed");
