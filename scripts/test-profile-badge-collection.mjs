import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, badges, phaseA, css, privacyPolicy] = await Promise.all([
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../profile-badges.js", import.meta.url), "utf8"),
  readFile(new URL("../profile-phase-a.js", import.meta.url), "utf8"),
  readFile(new URL("../profile-phase-a.css", import.meta.url), "utf8"),
  readFile(new URL("../profile-privacy-policy.mjs", import.meta.url), "utf8")
]);

assert.match(html, /id="profile-badges-section"/, "profile has a badge section");
assert.match(html, /id="profile-badges-view-all"[^>]*class="[^"]*secondary-button/, "View all badges uses the existing AnonChat secondary button style");
assert.match(html, /id="profile-badges-private-note"[^>]*>Hidden from others</, "owner has a badge-specific hidden indicator");
assert.match(html, /<dialog[^>]+id="profile-badges-collection-dialog"[^>]+class="[^"]*profile-badge-dialog/, "full badge collection reuses the existing badge dialog treatment");
assert.match(html, /id="profile-badges-collection"/, "full badge dialog has a collection container");
assert.match(html, /id="profile-badges-collection-close"[^>]+class="[^"]*secondary-button/, "collection close action uses existing button styling");

assert.match(badges, /profile-badges-collection-dialog/, "badge controller binds the collection dialog");
assert.match(badges, /openBadgeCollection|showModal\(\)/, "View all can open the badge collection");
assert.match(badges, /milestoneThreshold|milestoneMetric/, "collection exposes the badge requirement");
assert.match(badges, /tier/, "collection exposes badge tier");
assert.match(badges, /earnedAt|Earned/, "collection exposes earned date for permanent badges");
assert.match(badges, /premium-member|paid Premium is active|paid Premium/, "Premium badge detail is described as an active status rather than permanent ownership");
assert.match(badges, /imageUrl/, "collection renders badge artwork");

assert.match(phaseA, /profile-badges-private-note/, "privacy integration controls the badge-specific hidden indicator");
assert.match(phaseA, /ownerView[\s\S]*showBadges|showBadges[\s\S]*ownerView/, "owner-only hidden indicator is derived from badge privacy");
assert.match(privacyPolicy, /showBadges:\s*true/, "badge visibility defaults to public");
assert.match(css, /profile-badges-private-note/, "hidden indicator uses the existing profile stylesheet");
assert.match(css, /profile-badges-collection/, "full collection uses profile styling rather than browser defaults");

console.log("private-aware profile badge collection contract passed");
