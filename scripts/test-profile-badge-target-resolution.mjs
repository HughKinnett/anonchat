import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [badges, phaseA, html, css] = await Promise.all([
  readFile(new URL("profile-badges.js", root), "utf8"),
  readFile(new URL("profile-phase-a.js", root), "utf8"),
  readFile(new URL("profile.html", root), "utf8"),
  readFile(new URL("profile-phase-a.css", root), "utf8")
]);

assert.match(badges, /import\s*\{[^}]*auth[^}]*db[^}]*\}\s*from\s*["']\.\/firebase-config\.js["']/s,
  "badge controller can resolve the signed-in owner when no uid query is present");
assert.match(badges, /auth\.authStateReady\(\)|onAuthStateChanged/,
  "badge controller waits for authentication before resolving an own-profile target");
assert.match(badges, /queryUid|searchParams|URLSearchParams/,
  "badge controller still honors an explicit other-user uid query");
assert.match(badges, /currentUser\?\.uid|currentUser\.uid/,
  "badge controller falls back to the signed-in user's uid for their own profile");
assert.doesNotMatch(badges, /if \(!targetUserId\s*\|\|\s*profileUnavailable\(\)\) return;/,
  "badge loading is no longer blocked solely by a missing uid query parameter");

assert.match(phaseA, /currentUser\?\.uid|viewer\.uid/,
  "profile privacy controller has access to the authenticated viewer uid");
assert.match(phaseA, /effectiveProfileUid|profileUid|targetUserId\s*\|\|\s*viewer\.uid/,
  "profile privacy resolves the same effective owner profile when uid is absent");

assert.match(html, /id="profile-badges-section"/,
  "profile keeps a clearly labeled Badges section");
assert.match(html, /id="profile-badges-empty"[^>]*class="[^"]*profile-badges-empty/,
  "profile includes a themed empty badge state for owners with zero awards");
assert.match(css, /\.profile-badges-empty/,
  "empty badge state uses the existing profile stylesheet");
assert.match(html, /id="profile-badges-view-all"[^>]*class="[^"]*secondary-button/,
  "badge collection action uses the existing AnonChat secondary button theme");

console.log("profile badge target and discoverability contract passed");
