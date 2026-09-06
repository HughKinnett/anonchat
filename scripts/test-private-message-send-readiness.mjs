import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [community, timeline, bootstrap, readiness] = await Promise.all([
  readFile(new URL("../community.js", import.meta.url), "utf8"),
  readFile(new URL("../timeline.js", import.meta.url), "utf8"),
  readFile(new URL("../e2ee-bootstrap.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../private-message-send-readiness.js", import.meta.url), "utf8").catch(() => "")
]);

assert.match(community, /That user has not enabled encrypted chats yet\./,
  "direct-key path still detects a missing recipient identity");
assert.match(timeline, /import\s+["']\.\/e2ee-bootstrap\.js["']/,
  "the normal signed-in landing module loads E2EE identity bootstrap");
assert.match(bootstrap, /ensureE2eeIdentity\(/,
  "E2EE bootstrap publishes the signed-in user's identity before private messaging is needed");
assert.match(community, /import\s+["']\.\/private-message-send-readiness\.js["']/,
  "private-message module loads readiness guard");
assert.match(readiness, /getE2eePublicIdentity\(/,
  "readiness guard checks the selected recipient's public identity");
assert.match(readiness, /open AnonChat once|encryption setup|encrypted messages are not ready/i,
  "private-message send gives an actionable readiness message when the recipient key is unavailable");
assert.match(readiness, /stopImmediatePropagation\(/,
  "readiness guard prevents the generic send handler from swallowing the specific readiness failure");
assert.match(readiness, /dataset\.e2eeReady[\s\S]*requestSubmit\(/,
  "ready conversations resume the existing send flow exactly once");

console.log("Private-message send readiness contract passed.");
