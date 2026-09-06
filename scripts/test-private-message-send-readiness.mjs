import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [community, upload, typing, bootstrap, readiness, navMenu] = await Promise.all([
  readFile(new URL("../community.js", import.meta.url), "utf8"),
  readFile(new URL("../upload.js", import.meta.url), "utf8"),
  readFile(new URL("../private-message-typing-integration.js", import.meta.url), "utf8"),
  readFile(new URL("../e2ee-bootstrap.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../private-message-send-readiness.js", import.meta.url), "utf8").catch(() => ""),
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
  "private-message integration loads the readiness guard");
assert.match(readiness, /getE2eePublicIdentity\(/,
  "readiness guard checks the selected recipient's public identity");
assert.match(readiness, /open AnonChat once|encryption setup|encrypted messages are not ready/i,
  "private-message send gives an actionable readiness message when the recipient key is unavailable");
assert.match(readiness, /stopImmediatePropagation\(/,
  "readiness guard prevents the generic send handler from swallowing the specific readiness failure");
assert.match(readiness, /dataset\.e2eeReady[\s\S]*requestSubmit\(/,
  "ready conversations resume the existing send flow exactly once");

const createRequestBlock = community.match(/const createMessageRequest = async \(to\) => \{([\s\S]*?)\n\};\n\nconst renderMessageUsers/)?.[1] || "";
assert.match(createRequestBlock, /getE2eePublicIdentity\(db, to\)/,
  "message-request creation checks recipient encryption readiness before auto-accepting a mutual conversation");
assert.match(createRequestBlock, /autoAccept/,
  "mutual follows only become immediately accepted when encryption is ready");
assert.match(createRequestBlock, /status:\s*autoAccept\s*\?\s*["']accepted["']\s*:\s*["']pending["']/,
  "message request status uses encryption-ready auto-accept rather than mutual-follow status alone");

assert.match(community, /action === ["']accept-incoming["'][\s\S]*await ensureE2eeIdentity\(db, state\.user\)[\s\S]*updateDoc\(existing\.ref, \{ status: ["']accepted["']/,
  "accepting an incoming request establishes the local encryption identity before marking the conversation accepted");

console.log("Private-message send readiness contract passed.");
