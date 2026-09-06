import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, integration, policy, rules] = await Promise.all([
  readFile("community.html", "utf8"),
  readFile("private-message-reactions-integration.js", "utf8"),
  readFile("private-message-reaction-policy.mjs", "utf8"),
  readFile("firestore.rules", "utf8")
]);

assert.match(html, /private-message-reactions-integration\.js/);
assert.match(integration, /MESSAGE_REACTIONS/);
assert.match(integration, /nextMessageReaction/);
assert.match(integration, /messageReactions/);
assert.match(integration, /data-message-id/);
for (const reaction of ["👍", "❤️", "😂", "😮", "😢", "😡", "🖕"]) {
  assert.equal(policy.includes(reaction), true, `missing approved reaction ${reaction}`);
}
assert.match(rules, /messageRequests\/\{requestId\}\/messageReactions\/\{reactionId\}/);
assert.match(rules, /acceptedConversation\(requestId\)/);
assert.match(rules, /\['👍', '❤️', '😂', '😮', '😢', '😡', '🖕'\]/);

console.log("private message reactions integration policy passed");
