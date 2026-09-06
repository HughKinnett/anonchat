import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [community, timeline] = await Promise.all([
  readFile(new URL("../community.js", import.meta.url), "utf8"),
  readFile(new URL("../timeline.js", import.meta.url), "utf8")
]);

assert.match(community, /That user has not enabled encrypted chats yet\./,
  "current direct-key path exposes the missing-recipient-identity condition");
assert.match(community, /catch \(error\)[\s\S]*Could not send private message|catch \{[\s\S]*Could not send private message/,
  "current send path collapses encryption readiness failures into a generic send error");
assert.match(timeline, /ensureE2eeIdentity\(/,
  "the normal signed-in landing surface initializes the user's E2EE identity before they need private messages");
assert.match(community, /encrypted messages are not ready|open AnonChat once|encryption setup/i,
  "private-message send gives an actionable readiness message when the recipient key is unavailable");

console.log("Private-message send readiness contract passed.");
