import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [community, upload, typing, bootstrap, requestReadiness, navMenu] = await Promise.all([
  readFile(new URL("../community.js", import.meta.url), "utf8"),
  readFile(new URL("../upload.js", import.meta.url), "utf8"),
  readFile(new URL("../private-message-typing-integration.js", import.meta.url), "utf8"),
  readFile(new URL("../e2ee-bootstrap.js", import.meta.url), "utf8").catch(() => ""),
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

assert.doesNotMatch(typing, /private-message-send-readiness\.js/,
  "private-message typing integration does not install a second submit interceptor");
assert.doesNotMatch(community, /requestSubmit\(/,
  "private-message send does not recursively resubmit the form from inside submit handling");
const directSubmit = community.match(/\$\("direct-message-form"\)\.addEventListener\("submit", async \(event\) => \{([\s\S]*?)\n\}\);/)?.[1] || "";
assert.match(directSubmit, /getE2eePublicIdentity\(db, other\)/,
  "the one real private-message submit path checks recipient encryption readiness directly");
assert.match(directSubmit, /Encrypted messages are not ready|open AnonChat once|encryption setup/i,
  "the one real submit path gives an actionable message when recipient encryption is unavailable");
assert.match(directSubmit, /const key = await directKeyFor\(other\)/,
  "the normal encrypted send path continues after readiness succeeds");

assert.match(typing, /import\s+["']\.\/private-message-request-readiness\.js["']/,
  "private-message integration still loads the request readiness guard");
assert.match(requestReadiness, /ensureE2eeIdentity\(db, user\)/,
  "request readiness ensures the local user has an encryption identity before request actions continue");
assert.match(requestReadiness, /getE2eePublicIdentity\(db, otherUid\)/,
  "request readiness can require the other user's public identity before an immediate encrypted conversation");
assert.match(requestReadiness, /messageRequests/,
  "request readiness distinguishes existing incoming requests from new request creation");
assert.match(requestReadiness, /follows/,
  "request readiness detects mutual-follow auto-accept cases");

console.log("Private-message send readiness contract passed.");
