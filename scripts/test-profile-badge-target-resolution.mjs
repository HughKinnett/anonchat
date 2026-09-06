import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [badges, phaseA, html, css] = await Promise.all([
  readFile(new URL("profile-badges.js", root), "utf8"),
  readFile(new URL("profile-phase-a.js", root), "utf8"),
  readFile(new URL("profile.html", root), "utf8"),
  readFile(new URL("profile-phase-a.css", root), "utf8")
]);

assert.match(html, /id="profile-badges-open"[^>]*class="[^"]*secondary-button[^\"]*"[^>]*>Badges<\/button>/,
  "profile action row exposes a clearly labeled themed Badges button");
assert.match(badges, /profile-badges-open/,
  "badge controller wires the profile Badges entry button to the collection dialog");
assert.match(badges, /entryButton\.hidden\s*=\s*false/,
  "badge controller can reveal the Badges action");
assert.doesNotMatch(phaseA, /badgeEntryButton|profile-badges-open/,
  "profile privacy controller does not independently own badge entry visibility");

assert.doesNotMatch(html, /id="profile-badges-section"/,
  "earned badges are not displayed inline above Spotify");
assert.doesNotMatch(html, /id="profile-badges-list"/,
  "profile does not render an inline badge preview list");
assert.doesNotMatch(html, /id="profile-badges-view-all"/,
  "profile does not render a second View all badges action outside the dialog");
assert.match(html, /id="profile-badges-collection-dialog"/,
  "badge collection remains available behind the Badges action");
assert.match(html, /id="profile-badges-collection-empty"[^>]*>No badges earned yet\.<\/p>/,
  "badge collection has an empty state for owners with zero awards");
assert.match(css, /\.profile-badge-dialog\{[^}]*background\s*:\s*var\(--surface\)[^}]*color\s*:\s*var\(--text\)/,
  "badge collection and detail dialogs use the AnonChat surface and text tokens");
assert.match(css, /\.profile-badge-collection-card\{[^}]*background\s*:\s*var\(--surface-2\)[^}]*border\s*:\s*1px solid var\(--border\)/,
  "badge cards use themed card background and border tokens");

console.log("profile badge button-only access contract passed");
