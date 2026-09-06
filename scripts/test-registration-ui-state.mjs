import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [login, indexHtml, sw] = await Promise.all([
  readFile(new URL("../loginfirebase.js", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8")
]);

assert.match(indexHtml, /id="signup-registration-summary"/, "signup page exposes a live registration summary element");
assert.match(login, /signUpForm\.classList\.toggle\("signup-locked-form", !signupsOpen\)/, "ON state removes the locked signup styling");
assert.match(login, /signupButton\.textContent = signupsOpen \? "Create Account" : "Signups Paused"/, "signup button visibly reflects the registration toggle");
assert.match(login, /registrationSummary\.textContent = signupsOpen \? "New account registration is open\."/, "signup summary visibly reflects the registration toggle");
assert.match(login, /Could not check whether new registrations are open/, "registration flag read failures are surfaced instead of silently appearing paused");
assert.match(sw, /const CACHE_NAME = "anonchat-v142";/, "PWA cache version is bumped so the corrected signup page replaces stale cached assets");
console.log("registration UI state regression passed");
