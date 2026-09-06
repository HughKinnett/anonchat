import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [community, communityHtml, acceptedReadiness, upload, typing, bootstrap, requestReadiness, navMenu, sw] = await Promise.all([
  readFile(new URL("../community.js", import.meta.url), "utf8"),
  readFile(new URL("../community.html", import.meta.url), "utf8"),
  readFile(new URL("../private-message-accepted-readiness.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../upload.js", import.meta.url), "utf8"),
  readFile(new URL("../private-message-typing-integration.js", import.meta.url), "utf8"),
  readFile(new URL("../e2ee-bootstrap.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../private-message-request-readiness.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../nav-menu.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../sw.js", import.meta.url), "utf8").catch(() => "")
]);

assert.match(community, /\$\("direct-message-form"\)\.addEventListener\("submit", async \(event\) =>/,
  "community keeps one authoritative private-message submit handler");
assert.match(community, /const key = await directKeyFor\(other\)/,
  "the authoritative submit handler performs encryption through directKeyFor");
assert.doesNotMatch(community, /requestSubmit\(/,
  "community does not recursively resubmit the private-message form");

assert.match(communityHtml, /private-message-accepted-readiness\.js/,
  "the Messages surface loads accepted-conversation encryption readiness state");
assert.match(acceptedReadiness, /getE2eePublicIdentity\(db, otherUid\)/,
  "accepted-conversation readiness checks whether the recipient has a published E2EE identity");
assert.match(acceptedReadiness, /This accepted conversation is ready, but the other user must open AnonChat once to finish encrypted-chat setup before you can send\./,
  "older accepted conversations explain the recipient encryption setup requirement instead of appearing broken");
assert.match(acceptedReadiness, /sendButton\.disabled = !ready/,
  "Send is disabled only while the accepted recipient lacks encryption readiness");
assert.match(acceptedReadiness, /messageInput\.disabled = !ready/,
  "the composer cannot submit plaintext while recipient encryption is unavailable");
assert.match(acceptedReadiness, /conversation\.addEventListener\("change", refresh\)/,
  "changing accepted conversations refreshes encryption readiness");
assert.match(acceptedReadiness, /window\.addEventListener\("focus", refresh\)/,
  "returning to AnonChat rechecks readiness after the recipient has opened the app");
assert.doesNotMatch(acceptedReadiness, /addEventListener\("submit"/,
  "readiness state does not add a second private-message submit interceptor");
assert.doesNotMatch(acceptedReadiness, /requestSubmit\(/,
  "readiness state never recursively resubmits the form");

assert.match(upload, /import\s+["']\.\/e2ee-bootstrap\.js["']/,
  "the normal signed-in landing surface loads E2EE identity bootstrap through its upload/profile module");
assert.match(bootstrap, /ensureE2eeIdentity\(/,
  "E2EE bootstrap publishes the signed-in user's identity before private messaging is needed");
assert.match(navMenu, /import\(["']\.\/e2ee-bootstrap\.js["']\)/,
  "every normal signed-in page that loads the shared hamburger menu also starts E2EE bootstrap");

assert.doesNotMatch(typing, /private-message-send-readiness\.js/,
  "mobile private-message Send has no second submit interceptor");
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
assert.match(sw, /CACHE_NAME\s*=\s*["']anonchat-v141["']/,
  "service-worker cache advances so installed clients receive the accepted-conversation readiness fix");
assert.match(sw, /private-message-accepted-readiness\.js/,
  "the readiness module is cached for installed AnonChat clients");

console.log("Private-message send readiness contract passed.");
