import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalConversationId, isCanonicalConversationId } from "../private-conversation-id.mjs";

assert.equal(canonicalConversationId("b", "a"), "a_b");
assert.equal(canonicalConversationId("a", "b"), "a_b");
assert.equal(isCanonicalConversationId("a_b", "a", "b"), true);
assert.equal(isCanonicalConversationId("legacy123", "a", "b"), false);
assert.throws(() => canonicalConversationId("", "b"), /participant/i);
assert.throws(() => canonicalConversationId("a", "a"), /distinct/i);

const root = new URL("../", import.meta.url);
const [community, visibility] = await Promise.all([
  readFile(new URL("community.js", root), "utf8"),
  readFile(new URL("private-message-visibility-integration.js", root), "utf8")
]);

assert.match(community, /from ["']\.\/private-conversation-id\.mjs["']/,
  "community imports the canonical conversation ID helper");
assert.match(community, /const canonicalId = canonicalConversationId\(state\.user\.uid, other\)/,
  "private-message Send resolves the selected participant pair to the canonical ID");
assert.match(community, /doc\(db, "messageRequests", canonicalId\)/,
  "Send verifies the canonical accepted conversation header");
assert.match(community, /collection\(db, "messageRequests", canonicalId, "messages"\)/,
  "new encrypted messages are always written under the canonical conversation ID");
assert.doesNotMatch(community, /collection\(db, "messageRequests", acceptedRequest\.id, "messages"\)/,
  "Send never writes a new message beneath a legacy accepted request ID");
assert.match(visibility, /from ["']\.\/private-conversation-id\.mjs["']/,
  "participant-local visibility uses the same canonical conversation helper");
assert.doesNotMatch(visibility, /const pairIdFor =/,
  "visibility integration does not maintain a second pair-ID implementation");

console.log("canonical private-conversation ID contract passed");
