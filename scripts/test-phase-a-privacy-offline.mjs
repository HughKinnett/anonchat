import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, sw] = await Promise.all([
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../sw.js", import.meta.url), "utf8")
]);

for (const marker of [
  /class="profile-connections-links" data-profile-private-hidden="true"/,
  /id="profile-badges-section"[^>]*data-profile-private-hidden="true"/,
  /id="profile-spotify-card"[^>]*data-profile-private-hidden="true"/,
  /id="profile-playlist-card"[^>]*data-profile-private-hidden="true"/,
  /class="profile-posts-section"[^>]*data-profile-private-hidden="true"/
]) assert.match(html, marker, "privacy-sensitive profile surfaces start hidden until viewer visibility is resolved");

for (const asset of ["profile-phase-a.css", "profile-phase-a.js", "profile-privacy-policy.mjs", "profile-share.mjs", "profile-pinning.mjs"]) {
  assert.match(sw, new RegExp(asset.replaceAll(".", "\\.")), `service worker caches ${asset}`);
}
assert.match(sw, /qrcode@1\.5\.4\/build\/qrcode\.min\.js/, "service worker recognizes the QR library URL");
assert.match(sw, /event\.request\.url === QR_LIBRARY_URL/, "service worker handles the cross-origin QR library explicitly");
assert.match(sw, /cache\.put\(event\.request, copy\)/, "QR library is runtime cached after a successful online load");

console.log("phase A privacy/offline contract tests passed");
