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
assert.match(badges, /queryUserId|searchParams|URLSearchParams/,
  "badge controller still honors an explicit other-user uid query");
assert.match(badges, /targetUserId\s*=\s*queryUserId\s*\|\|\s*auth\.currentUser\?\.uid\s*\|\|\s*null[\s\S]*if \(!targetUserId\s*\|\|\s*profileUnavailable\(\)\) return;/,
  "badge controller resolves query uid or authenticated owner before the final no-target safety guard");

assert.match(phaseA, /viewer\s*=\s*auth\.currentUser/,
  "profile privacy controller resolves the authenticated viewer");
assert.match(phaseA, /targetUserId\s*=\s*queryUserId\s*\|\|\s*viewer\.uid/,
  "profile privacy resolves the same effective owner profile when uid is absent");

assert.match(html, /id="profile-badges-open"[^>]*class="[^"]*secondary-button[^\"]*"[^>]*>Badges<\/button>/,
  "profile action row exposes a clearly labeled themed Badges button");
assert.match(phaseA, /profile-badges-open/,
  "profile privacy controller owns the public visibility of the Badges entry button");
assert.match(phaseA, /badgeEntryButton\.hidden\s*=\s*!visibility\.badges/,
  "Badges entry button is visible to owners/public visitors and hidden from visitors when badges are private");
assert.match(badges, /profile-badges-open/,
  "badge controller wires the profile Badges entry button to the collection dialog");

assert.match(html, /id="profile-badges-section"/,
  "profile keeps a clearly labeled Badges section");
assert.match(html, /id="profile-badges-empty"[^>]*class="[^"]*profile-badges-empty/,
  "profile includes a themed empty badge state for owners with zero awards");
assert.match(css, /\.profile-badges-empty/,
  "empty badge state uses the existing profile stylesheet");
assert.match(html, /id="profile-badges-view-all"[^>]*class="[^"]*secondary-button/,
  "badge collection action uses the existing AnonChat secondary button theme");
assert.match(html, /id="profile-badges-collection-empty"[^>]*>No badges earned yet\.<\/p>/,
  "badge collection itself has an empty state so the Badges button always opens something useful");
assert.doesNotMatch(badges, /openBadgeCollection[\s\S]{0,250}!allBadges\.length/,
  "badge collection opening is not blocked just because the user has zero badges");

console.log("profile badge target and discoverability contract passed");
