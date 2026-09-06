import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../profile.js", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /if\s*\(\s*!user\.emailVerified\s*\)\s*\{[\s\S]{0,300}?exitAuthenticatedSession\s*\(/,
  "profile navigation must not sign out an authenticated user only because their email is unverified"
);

assert.match(
  source,
  /if\s*\(\s*!user\s*\)\s*\{[\s\S]{0,300}?exitAfterAuthLoss\s*\(/,
  "profile navigation must still redirect when Firebase auth is actually lost"
);

console.log("Profile auth guard regression checks passed.");
