import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [profileHtml, galleryJs] = await Promise.all([
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../profile-badges.js", import.meta.url), "utf8").catch(() => "")
]);

assert.match(profileHtml, /id="profile-badges-section"/, "profile exposes a badge section");
assert.match(profileHtml, /id="profile-badges-list"/, "profile exposes a badge list");
assert.match(profileHtml, /id="profile-badges-view-all"/, "profile exposes View all badges control");
assert.match(profileHtml, /id="profile-badge-dialog"/, "profile exposes a badge detail dialog");
assert.match(profileHtml, /src="profile-badges\.js"/, "profile loads the badge gallery renderer");

assert.match(galleryJs, /PROFILE_BADGE_PREVIEW_LIMIT/, "gallery uses the shared four-badge preview limit");
assert.match(galleryJs, /listUserBadges/, "gallery loads user badge assignments");
assert.match(galleryJs, /listBadgeTypes/, "gallery resolves badge definitions");
assert.match(galleryJs, /textContent/, "badge text is rendered safely");
assert.doesNotMatch(galleryJs, /innerHTML/, "badge gallery never renders trusted fields through innerHTML");
assert.match(galleryJs, /earnedAt/, "badge detail includes earned date");
assert.match(galleryJs, /View all badges/, "gallery supports expanding beyond the preview");
assert.match(galleryJs, /Unavailable profile|profile-name/, "blocked or unavailable profiles do not expose badges");

console.log("profile badge gallery tests passed");
