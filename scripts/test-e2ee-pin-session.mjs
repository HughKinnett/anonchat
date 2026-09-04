import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const identity = await readFile(new URL("../e2ee-identity.js", import.meta.url), "utf8");
const community = await readFile(new URL("../community.js", import.meta.url), "utf8");

assert.match(identity, /export const clearE2eeSession = uid => \{[\s\S]*?identityCache\.delete\(uid\)[\s\S]*?identityCache\.clear\(\)[\s\S]*?pinAttempts\.clear\(uid\)[\s\S]*?\};/,
  "sign-out/session teardown must clear decrypted identity cache and PIN-attempt state");
assert.match(identity, /export const clearE2eeIdentity = uid => clearE2eeSession\(uid\)/,
  "existing logout callers must delegate to the stronger session clear path");
assert.doesNotMatch(identity, /clearE2eeSession[\s\S]{0,300}removeTrustedDeviceRecord/,
  "ordinary sign-out must not erase the encrypted trusted-device PIN record");
assert.match(community, /clearE2eeIdentity\(state\.user\?\.uid\)/,
  "community teardown must clear decrypted E2EE session material");
assert.match(identity, /if \(record\) \{[\s\S]*?unlockTrustedIdentity[\s\S]*?\} else \{[\s\S]*?recoveryPassphraseDialog\(\)/,
  "an existing Firebase identity without local trusted-device state must require recovery");
assert.match(identity, /if \(!privateSnapshot\.exists\(\)\) \{[\s\S]*?recoveryPassphraseDialog\(\{ setup: true \}\)/,
  "only an account with no Firebase E2EE identity may enter new-identity setup");

console.log("E2EE four-digit PIN session and recovery policy passed.");
