import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [rules, announcement, login, timeline, profile, community, premiumPlaylist, packageJson] = await Promise.all([
  readFile(new URL("../firestore.rules", import.meta.url), "utf8"),
  readFile(new URL("../site-announcement.js", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../loginfirebase.js", import.meta.url), "utf8"),
  readFile(new URL("../timeline.html", import.meta.url), "utf8"),
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../community.html", import.meta.url), "utf8"),
  readFile(new URL("../premium-playlist.js", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);

assert.match(rules, /match \/siteSettings\/\{settingId\}[\s\S]{0,350}allow read: if[^;]*(features|announcement)/,
  "feature and announcement settings can be read by the user-facing app");
assert.match(rules, /featureEnabled\('uploadsEnabled'\)/, "Firestore rules enforce the photo-upload switch");
assert.match(rules, /featureEnabled\('spotifyEmbedsEnabled'\)/, "Firestore rules enforce the Spotify-embed switch");

assert.match(login, /siteSettings["'],\s*["']features/, "signup checks the site feature settings");
assert.match(login, /registrationsEnabled[^\n]{0,250}(false|paused|registration)/i,
  "signup stops cleanly when registrations are paused");

assert.match(announcement, /siteSettings["'],\s*["']announcement/, "site announcement listens to the admin announcement document");
assert.match(announcement, /onSnapshot/, "site announcement updates live");
assert.match(announcement, /anonchat-site-announcement/, "site announcement uses one shared banner");
for (const [name, html] of [["timeline",timeline],["profile",profile],["community",community]]) {
  assert.match(html, /site-announcement\.js/, `${name} loads the shared site announcement`);
}

assert.match(premiumPlaylist, /siteSettings["'],\s*["']features/, "Spotify settings page reads the admin feature switch");
assert.match(premiumPlaylist, /spotifyEmbedsEnabled/, "Spotify settings page disables saving while Spotify embeds are paused");

assert.match(packageJson, /test-admin-site-control-enforcement\.mjs/, "normal admin-dashboard tests include user-facing control enforcement");

console.log("admin site-control enforcement tests passed");
