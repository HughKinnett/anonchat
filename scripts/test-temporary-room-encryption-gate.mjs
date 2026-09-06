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

assert.match(
  navMenu,
  /href\s*===?\s*["']community\.html["']|getAttribute\(["']href["']\)\s*===?\s*["']community\.html["']/,
  "hamburger navigation must identify the Temporary Rooms link"
);

assert.match(
  navMenu,
  /ensureE2eeIdentity\s*\(/,
  "clicking Temporary Rooms in the hamburger menu must verify or set up encryption before navigation"
);

assert.match(
  navMenu,
  /preventDefault\s*\(\)[\s\S]{0,1200}?ensureE2eeIdentity\s*\([\s\S]{0,1200}?(location\.(assign|href)|window\.location)/,
  "Temporary Rooms navigation must be blocked until encryption setup succeeds"
);

assert.match(
  navMenu,
  /isEncryptionExemptUser\s*=\s*\([^)]*\)\s*=>[\s\S]{0,240}?displayName[\s\S]{0,160}?testaccount/i,
  "the encryption setup exemption must be explicit and scoped to TestAccount"
);

assert.match(
  navMenu,
  /if\s*\(\s*isEncryptionExemptUser\(user\)\s*\)\s*\{[\s\S]{0,240}?(location\.(assign|href)|window\.location)/,
  "TestAccount must bypass the Temporary Rooms encryption setup gate"
);

assert.doesNotMatch(
  navMenu,
  /isEncryptionExemptUser[\s\S]{0,180}?(admin|moderator|owner|verified|premium)/i,
  "the encryption exemption must not broaden to privileged or paid users"
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
  "temporary-room entry must retain an encryption readiness helper"
);

console.log("Temporary-room encryption gate regression checks passed.");
