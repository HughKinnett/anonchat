import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [profileHtml, profileJs, timelineHtml, uploadJs] = await Promise.all([
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../profile.js", import.meta.url), "utf8"),
  readFile(new URL("../timeline.html", import.meta.url), "utf8"),
  readFile(new URL("../upload.js", import.meta.url), "utf8")
]);

assert.match(profileHtml, /id="profile-bio-section"/, "public profile includes an About section");
assert.match(profileHtml, /id="profile-bio"/, "public profile includes a bio text element");
assert.match(profileJs, /targetProfile\.bio|targetProfile\?\.bio/, "profile renderer reads the saved bio");
assert.doesNotMatch(profileJs, /profile-bio[^\n]*innerHTML/, "profile bio is never rendered with innerHTML");
assert.match(timelineHtml, /id="profile-bio-input"[^>]*maxlength="300"|maxlength="300"[^>]*id="profile-bio-input"/, "existing profile editor exposes a 300-character bio field");
assert.match(uploadJs, /bio/, "existing profile edit script saves bio changes");

console.log("profile bio surface tests passed");
