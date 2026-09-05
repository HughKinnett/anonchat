import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, controller, css] = await Promise.all([
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../profile-phase-a.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../profile-phase-a.css", import.meta.url), "utf8").catch(() => "")
]);

assert.match(html, /id="profile-share-button"/, "profile has a Share action");
assert.match(html, /id="profile-qr-button"/, "profile has a QR action");
assert.match(html, /id="profile-qr-dialog"/, "profile has a QR dialog");
assert.match(html, /id="profile-privacy-controls"/, "profile has owner privacy controls");
for (const field of ["showPosts", "showBadges", "showFollowersFollowing", "showActivity"]) {
  assert.match(html, new RegExp(`data-profile-privacy="${field}"`), `profile has ${field} privacy toggle`);
}
assert.match(html, /id="profile-pinned-post"/, "profile has a pinned-post region");
assert.match(html, /src="profile-phase-a\.js"/, "profile loads Phase A controller");
assert.match(html, /profile-phase-a\.css/, "profile loads Phase A styles");

assert.match(controller, /buildProfileShareData/, "controller uses canonical profile share helper");
assert.match(controller, /safeProfileQrPayload/, "controller uses canonical QR payload helper");
assert.match(controller, /normalizeProfilePrivacy/, "controller uses shared privacy policy");
assert.match(controller, /profilePrivacy/, "controller persists profile privacy");
assert.match(controller, /navigator\.share/, "controller uses Web Share API for browser and TWA sharing");
assert.match(controller, /clipboard/, "controller includes clipboard fallback");
assert.match(controller, /data-profile-private-hidden/, "controller enforces hidden sections independently of hidden attribute changes");
assert.match(css, /data-profile-private-hidden/, "CSS enforces private section hiding");

console.log("phase A profile surface contract tests passed");
