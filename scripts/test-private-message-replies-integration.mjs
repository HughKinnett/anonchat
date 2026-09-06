import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, integration, community, rules] = await Promise.all([
  readFile("community.html", "utf8"),
  readFile("private-message-replies-integration.js", "utf8"),
  readFile("community.js", "utf8"),
  readFile("firestore.rules", "utf8")
]);

assert.match(html, /private-message-replies-integration\.js/);
assert.match(integration, /resolveReplyPreview/);
assert.match(integration, /Reply/);
assert.match(integration, /replyToMessageId/);
assert.match(integration, /Original message unavailable\./);
assert.match(integration, /data-message-id/);
assert.match(integration, /originalBubble\?\.hidden/,
  "a Delete-for-me hidden original must not leak its text through a visible reply quote");
assert.match(community, /replyToMessageId/);
assert.match(community, /replyToSenderId/);
assert.match(rules, /replyToMessageId/);
assert.match(rules, /replyToSenderId/);

console.log("private message replies integration policy passed");
