import assert from "node:assert/strict";
import fs from "node:fs";

// Keep profile navigation from treating an unverified email as an authentication loss.
const source = fs.readFileSync(new URL("../profile.js", import.meta.url), "utf8");
const profileHtml = fs.readFileSync(new URL("../profile.html", import.meta.url), "utf8");
const bootstrap = fs.readFileSync(new URL("../profile-bootstrap.js", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");

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

assert.match(
  profileHtml,
  /profile-bootstrap\.js\?v=145/,
  "profile.html must request a versioned profile bootstrap so clients cannot reuse the stale logout bundle"
);

assert.match(
  bootstrap,
  /import\("\.\/profile\.js\?v=145"\)/,
  "profile bootstrap must request the fixed profile module with a cache-busting version"
);

const cacheVersion = Number(serviceWorker.match(/CACHE_NAME\s*=\s*["']anonchat-v(\d+)["']/)?.[1] || 0);
assert.ok(
  cacheVersion >= 145,
  "service worker cache must remain at or above the profile cache-bust version so stale profile modules are discarded"
);

console.log("Profile auth guard regression checks passed.");
