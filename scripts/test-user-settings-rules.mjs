import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

assert.match(rules, /match \/users\/\{userId\}\/private\/settings\/preferences/,
  "settings preferences have a dedicated nested rule");
assert.match(rules, /allow read:\s*if signedIn\(\)\s*&& request\.auth\.uid == userId/,
  "only the owning user can read settings");
assert.match(rules, /allow create, update:\s*if activeUserAfter\(\)\s*&& request\.auth\.uid == userId/,
  "only the active owning user can write settings");
assert.match(rules, /validUserSettings\(request\.resource\.data\)/,
  "settings writes must pass schema validation");
assert.match(rules, /settings\.keys\(\)\.hasOnly\(\[/,
  "unknown settings fields are rejected by rules");
assert.match(rules, /messageRequestMode.*everyone.*following.*none/s,
  "message request privacy values are constrained");
assert.match(rules, /theme.*system.*light.*dark/s,
  "theme values are constrained");
assert.match(rules, /textSize.*small.*default.*large.*extra-large/s,
  "text size values are constrained");
assert.match(rules, /notifications\.keys\(\)\.hasOnly/,
  "notification categories use an explicit allowlist");
assert.match(rules, /quietHours\.start\.matches\(/,
  "quiet-hour start is validated as a clock time");
assert.match(rules, /quietHours\.end\.matches\(/,
  "quiet-hour end is validated as a clock time");
assert.match(rules, /allow delete:\s*if signedIn\(\)\s*&& request\.auth\.uid == userId/,
  "owner may reset settings by deleting the preferences document");

console.log("user settings Firestore rule contract tests passed");
