import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, integration, community, rules] = await Promise.all([
  readFile("community.html", "utf8"),
  readFile("private-message-visibility-integration.js", "utf8"),
  readFile("community.js", "utf8"),
  readFile("firestore.rules", "utf8")
]);

assert.match(html, /private-message-visibility-integration\.js/);
assert.match(integration, /canUnsendMessage/);
assert.match(integration, /Delete for me/);
assert.match(integration, /Unsend for everyone/);
assert.match(integration, /Message unsent/);
assert.match(integration, /messageVisibility/);
assert.doesNotMatch(community, /Delete for everyone/);
assert.doesNotMatch(community, /deleteDoc\(message\.ref\)/);
assert.match(rules, /messageRequests\/\{requestId\}\/messageVisibility\/\{visibilityId\}/);
assert.match(rules, /unsentAt/);
assert.match(rules, /unsentBy/);

console.log("private message delete/unsend integration policy passed");
