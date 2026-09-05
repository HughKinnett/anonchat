import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [profileHtml, profileBioJs, timelineHtml, uploadJs] = await Promise.all([
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../profile-bio.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../timeline.html", import.meta.url), "utf8"),
  readFile(new URL("../upload.js", import.meta.url), "utf8")
]);

assert.match(profileHtml, /id="profile-bio-section"/, "public profile includes an About section");
assert.match(profileHtml, /id="profile-bio"/, "public profile includes a bio text element");
assert.match(profileHtml, /src="profile-bio\.js"/, "public profile loads the dedicated bio renderer");
assert.match(profileBioJs, /\.bio/, "profile bio renderer reads the saved bio");
assert.match(profileBioJs, /textContent/, "profile bio is rendered as text");
assert.doesNotMatch(profileBioJs, /innerHTML/, "profile bio is never rendered with innerHTML");
assert.match(profileBioJs, /Unavailable profile|profile-name/, "blocked or unavailable profiles do not expose bio content");
assert.match(timelineHtml, /id="profile-bio-input"[^>]*maxlength="300"|maxlength="300"[^>]*id="profile-bio-input"/, "existing profile editor exposes a 300-character bio field");
assert.match(uploadJs, /bio/, "existing profile edit script saves bio changes");

console.log("profile bio surface tests passed");
