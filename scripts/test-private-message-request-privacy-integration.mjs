import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, community, rules] = await Promise.all([
  readFile("community.html", "utf8"),
  readFile("community.js", "utf8"),
  readFile("firestore.rules", "utf8")
]);

assert.match(html, /id="message-request-privacy"/);
assert.match(html, /value="everyone"/);
assert.match(html, /value="people-i-follow"/);
assert.match(html, /value="none"/);
assert.match(community, /canCreateMessageRequest/);
assert.match(community, /messageRequestPrivacy/);
assert.match(community, /people-i-follow/);
assert.match(rules, /match \/messageRequestPrivacy\/\{uid\}/);
assert.match(rules, /recipientAllowsMessageRequest/);
assert.match(rules, /people-i-follow/);
assert.match(rules, /messageRequestPrivacy/);

console.log("private message request privacy integration policy passed");
