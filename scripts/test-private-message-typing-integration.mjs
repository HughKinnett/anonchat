import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, integration, rules] = await Promise.all([
  readFile("community.html", "utf8"),
  readFile("private-message-typing-integration.js", "utf8"),
  readFile("firestore.rules", "utf8")
]);

assert.match(html, /id="direct-typing-status"/);
assert.match(html, /private-message-typing-integration\.js/);
assert.match(integration, /typingExpiresAt/);
assert.match(integration, /messageRequests/);
assert.match(integration, /"typing"/);
assert.match(integration, /direct-message/);
assert.match(integration, /conversation-user/);
assert.match(integration, /direct-typing-status/);
assert.match(rules, /messageRequests\/\{requestId\}\/typing\/\{uid\}/);
assert.match(rules, /acceptedConversation\(requestId\)/);
assert.match(rules, /uid == request\.auth\.uid/);

console.log("private message typing integration policy passed");
