import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, badges, css, privacyPolicy] = await Promise.all([
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../profile-badges.js", import.meta.url), "utf8"),
  readFile(new URL("../profile-phase-a.css", import.meta.url), "utf8"),
  readFile(new URL("../profile-privacy-policy.mjs", import.meta.url), "utf8")
]);

assert.match(html, /id="profile-badges-open"[^>]*class="[^"]*secondary-button/, "Badges action uses the existing AnonChat secondary button style");
assert.doesNotMatch(html, /id="profile-badges-section"|id="profile-badges-view-all"/,
  "badge previews are not displayed inline above Spotify");
assert.match(html, /<dialog[^>]+id="profile-badges-collection-dialog"[^>]+class="[^"]*profile-badge-dialog/, "full badge collection reuses the existing badge dialog treatment");
assert.match(html, /id="profile-badges-collection"/, "full badge dialog has a collection container");
assert.match(html, /id="profile-badges-collection-empty"[^>]*>No badges earned yet\.<\/p>/, "badge dialog has an empty state");
assert.match(html, /id="profile-badges-collection-close"[^>]+class="[^"]*secondary-button/, "collection close action uses existing button styling");

assert.match(badges, /profile-badges-collection-dialog/, "badge controller binds the collection dialog");
assert.match(badges, /entryButton\?\.addEventListener\("click", openBadgeCollection\)/, "Badges action opens the badge collection");
assert.match(badges, /ownerView[\s\S]*entryButton\.hidden\s*=\s*false/, "owner can open badges regardless of visitor privacy state");
assert.match(badges, /milestoneThreshold|milestoneMetric/, "collection exposes the badge requirement");
assert.match(badges, /tier/, "collection exposes badge tier");
assert.match(badges, /earnedAt|Earned/, "collection exposes earned date for permanent badges");
assert.match(badges, /premium-member|Premium badge entitlement is active/, "Premium badge detail supports trusted or paid entitlement");
assert.match(badges, /imageUrl/, "collection renders badge artwork");

assert.match(privacyPolicy, /showBadges:\s*true/, "badge visibility defaults to public");
assert.match(css, /profile-badges-collection/, "full collection uses profile styling rather than browser defaults");
assert.match(css, /profile-badge-dialog/, "badge dialog uses the existing AnonChat themed surface");

console.log("private-aware action-only profile badge collection contract passed");
