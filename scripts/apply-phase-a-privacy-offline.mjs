import { readFile, writeFile } from "node:fs/promises";

const profilePath = new URL("../profile.html", import.meta.url);
const swPath = new URL("../sw.js", import.meta.url);
let html = await readFile(profilePath, "utf8");
let sw = await readFile(swPath, "utf8");

const replacements = [
  ['class="profile-connections-links"', 'class="profile-connections-links" data-profile-private-hidden="true"'],
  ['id="profile-badges-section" class=', 'id="profile-badges-section" data-profile-private-hidden="true" class='],
  ['id="profile-spotify-card" data-profile-activity class=', 'id="profile-spotify-card" data-profile-activity data-profile-private-hidden="true" class='],
  ['id="profile-playlist-card" data-profile-activity class=', 'id="profile-playlist-card" data-profile-activity data-profile-private-hidden="true" class='],
  ['<section class="profile-posts-section" aria-labelledby="profile-posts-title">', '<section class="profile-posts-section" data-profile-private-hidden="true" aria-labelledby="profile-posts-title">']
];
for (const [before, after] of replacements) {
  if (!html.includes(after)) {
    if (!html.includes(before)) throw new Error(`Missing profile privacy anchor: ${before}`);
    html = html.replace(before, after);
  }
}

if (!sw.includes('const QR_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js";')) {
  sw = sw.replace('const CACHE_NAME = "anonchat-v129";', 'const QR_LIBRARY_URL = "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js";\nconst CACHE_NAME = "anonchat-v130";');
}
for (const asset of [
  '  "./profile-phase-a.css",',
  '  "./profile-phase-a.js",',
  '  "./profile-privacy-policy.mjs",',
  '  "./profile-share.mjs",',
  '  "./profile-pinning.mjs",'
]) {
  if (!sw.includes(asset)) sw = sw.replace('  "./profile-badges.js",', `  "./profile-badges.js",\n${asset}`);
}

const fetchAnchor = 'self.addEventListener("fetch", (event) => {\n  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;';
const fetchReplacement = `self.addEventListener("fetch", (event) => {\n  if (event.request.method !== "GET") return;\n  if (event.request.url === QR_LIBRARY_URL) {\n    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {\n      const copy = response.clone();\n      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));\n      return response;\n    }).catch(() => cached || Response.error())));\n    return;\n  }\n  if (new URL(event.request.url).origin !== self.location.origin) return;`;
if (!sw.includes('event.request.url === QR_LIBRARY_URL')) {
  if (!sw.includes(fetchAnchor)) throw new Error("Missing service worker fetch anchor");
  sw = sw.replace(fetchAnchor, fetchReplacement);
}

await Promise.all([writeFile(profilePath, html), writeFile(swPath, sw)]);
console.log("Phase A privacy/offline patch applied");
