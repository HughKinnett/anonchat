import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [community, upload, typing, bootstrap, readiness, requestReadiness, navMenu] = await Promise.all([
  readFile(new URL("../community.js", import.meta.url), "utf8"),
  readFile(new URL("../upload.js", import.meta.url), "utf8"),
  readFile(new URL("../private-message-typing-integration.js", import.meta.url), "utf8"),
  readFile(new URL("../e2ee-bootstrap.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../private-message-send-readiness.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../private-message-request-readiness.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../nav-menu.js", import.meta.url), "utf8").catch(() => "")
]);

assert.match(community, /That user has not enabled encrypted chats yet\./,
  "direct-key path still detects a missing recipient identity");
assert.match(upload, /import\s+["']\.\/e2ee-bootstrap\.js["']/,
  "the normal signed-in landing surface loads E2EE identity bootstrap through its upload/profile module");
assert.match(bootstrap, /ensureE2eeIdentity\(/,
  "E2EE bootstrap publishes the signed-in user's identity before private messaging is needed");
assert.match(navMenu, /import\(["']\.\/e2ee-bootstrap\.js["']\)/,
  "every normal signed-in page that loads the shared hamburger menu also starts E2EE bootstrap");
assert.match(typing, /import\s+["']\.\/private-message-send-readiness\.js["']/,
  "private-message integration loads the send readiness guard");
assert.match(typing, /import\s+["']\.\/private-message-request-readiness\.js["']/,
  "private-message integration loads the request readiness guard");
assert.match(readiness, /getE2eePublicIdentity\(/,
  "send readiness checks the selected recipient's public identity");
assert.match(readiness, /open AnonChat once|encryption setup|encrypted messages are not ready/i,
  "private-message send gives an actionable readiness message when the recipient key is unavailable");
assert.match(readiness, /stopImmediatePropagation\(/,
  "send readiness prevents the generic send handler from swallowing the specific readiness failure");
assert.match(readiness, /dataset\.e2eeReady[\s\S]*requestSubmit\(/,
  "ready conversations resume the existing send flow exactly once");

assert.match(requestReadiness, /ensureE2eeIdentity\(db, user\)/,
  "request readiness ensures the local user has an encryption identity before request actions continue");
assert.match(requestReadiness, /getE2eePublicIdentity\(db, otherUid\)/,
  "request readiness can require the other user's public identity before an immediate encrypted conversation");
assert.match(requestReadiness, /messageRequests/,
  "request readiness distinguishes existing incoming requests from new request creation");
assert.match(requestReadiness, /follows/,
  "request readiness detects mutual-follow auto-accept cases");
assert.match(requestReadiness, /stopImmediatePropagation\(/,
  "request readiness blocks the underlying request action until encryption readiness is known");
assert.match(requestReadiness, /dataset\.e2eeReady[\s\S]*\.click\(\)/,
  "ready request actions resume the existing request/accept handler exactly once");

console.log("Private-message send readiness contract passed.");
