import assert from "node:assert/strict";
import fs from "node:fs";

// Regression coverage for encryption setup being gated exclusively at temporary-room entry.
const community = fs.readFileSync(new URL("../community.js", import.meta.url), "utf8");
const navMenu = fs.readFileSync(new URL("../nav-menu.js", import.meta.url), "utf8");
const upload = fs.readFileSync(new URL("../upload.js", import.meta.url), "utf8");
const bootstrap = fs.readFileSync(new URL("../e2ee-bootstrap.js", import.meta.url), "utf8");
const requestReadiness = fs.readFileSync(new URL("../private-message-request-readiness.js", import.meta.url), "utf8");

assert.doesNotMatch(
  navMenu,
  /e2ee-bootstrap\.js/,
  "normal navigation must not initialize encryption or open encryption setup"
);

assert.doesNotMatch(
  upload,
  /e2ee-bootstrap\.js/,
  "timeline/profile upload startup must not initialize encryption"
);

assert.doesNotMatch(
  bootstrap,
  /ensureE2eeIdentity\s*\(/,
  "global bootstrap must never prompt for encryption setup"
);

assert.doesNotMatch(
  requestReadiness,
  /ensureE2eeIdentity\s*\(/,
  "private message request readiness must not prompt for encryption setup"
);

assert.doesNotMatch(
  community,
  /state\.profile\s*=\s*profile\.data\(\);[\s\S]{0,700}?ensureE2eeIdentity\(db,\s*user\)[\s\S]{0,400}?recordPageActivity/,
  "opening the Community screen must not initialize encryption before the user enters a temporary room"
);

assert.match(
  community,
  /const ensureTemporaryRoomEncryptionReady\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]{0,500}?ensureE2eeIdentity\(db,\s*state\.user\)[\s\S]{0,300}?state\.e2eeIdentity\s*=\s*identity[\s\S]{0,200}?return identity/,
  "temporary-room entry must have an explicit encryption readiness gate"
);

assert.match(
  community,
  /const openRoom\s*=\s*async\s*\([^)]*\)\s*=>\s*\{[\s\S]{0,500}?await ensureTemporaryRoomEncryptionReady\(\)[\s\S]{0,1200}?setDoc\(doc\(db,\s*"roomMembers"/,
  "joining/opening a temporary room must complete encryption setup before membership is written"
);

assert.match(
  community,
  /\$\("room-form"\)\.addEventListener\("submit",\s*async\s*\(event\)\s*=>\s*\{[\s\S]{0,500}?await ensureTemporaryRoomEncryptionReady\(\)[\s\S]{0,500}?createRoomKeyEnvelope/,
  "creating a temporary room must complete encryption setup before creating its encryption key"
);

console.log("Temporary-room encryption gate regression checks passed.");
