import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [admin, profile, renderer, badgeProcessor] = await Promise.all([
  readFile(new URL("../admin.js", import.meta.url), "utf8"),
  readFile(new URL("../profile-phase-a.js", import.meta.url), "utf8"),
  readFile(new URL("../profile.js", import.meta.url), "utf8"),
  readFile(new URL("../badge-award-processor.mjs", import.meta.url), "utf8")
]);

for (const key of ["badgeAwardsEnabled", "profilePinsEnabled", "profileQrEnabled"]) {
  assert.match(admin, new RegExp(key), `admin command center manages ${key}`);
}
assert.match(admin, /Badge awarding/i, "admin labels the badge-awarding switch clearly");
assert.match(admin, /Profile pinning/i, "admin labels the profile-pinning switch clearly");
assert.match(admin, /Profile QR/i, "admin labels the profile-QR switch clearly");
assert.match(profile, /profileQrEnabled/, "profile QR controller honors the emergency switch");
assert.match(renderer, /profilePinsEnabled/, "profile pin mutations honor the emergency switch");
assert.match(badgeProcessor, /badgeAwardsEnabled/, "automatic badge processing honors the emergency switch");
assert.match(badgeProcessor, /featureEnabled/, "badge processor asks the adapter for feature state before awarding");

console.log("phase A feature switch contract tests passed");
