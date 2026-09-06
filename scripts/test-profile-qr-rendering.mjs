import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, phaseA, renderer, deploy, sw] = await Promise.all([
  readFile(new URL("profile.html", root), "utf8"),
  readFile(new URL("profile-phase-a.js", root), "utf8"),
  readFile(new URL("profile-qr-renderer.mjs", root), "utf8"),
  readFile(new URL(".github/workflows/deploy-firebase.yml", root), "utf8"),
  readFile(new URL("sw.js", root), "utf8")
]);

assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/qrcode/i,
  "profile QR has no runtime CDN dependency");
assert.doesNotMatch(html, /vendor\/qrcode\.(?:min\.)?js/,
  "profile page does not depend on a global vendor script");
assert.match(phaseA, /from ["']\.\/profile-qr-renderer\.mjs["']/,
  "profile QR controller imports the local renderer wrapper");
assert.match(phaseA, /renderProfileQr\(canvas, payload\)/,
  "profile QR controller delegates rendering to the wrapper");
assert.match(renderer, /from ["']\.\/vendor\/qrcode\.mjs["']/,
  "renderer wrapper imports the locally hosted QR ESM bundle");
assert.match(renderer, /toCanvas\(/,
  "renderer wrapper uses the QR bundle canvas API");
assert.match(deploy, /https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode@1\.5\.4\/\+esm/,
  "production deploy pins the approved QR ESM source");
assert.match(deploy, /https:\/\/cdn\.jsdelivr\.net\/npm\/dijkstrajs@1\.0\.3\/\+esm/,
  "production deploy pins the QR dependency source");
assert.match(deploy, /f712a06862e06fdbb45fc846f9ad273624835025d8c4657c139a0d678d2d3733\s+vendor\/qrcode\.mjs/,
  "production deploy pins the exact QR bundle checksum");
assert.match(deploy, /62dc939c7c6d5b83a148931d0852d636a15f9d414023c1032647adcac06a4123\s+vendor\/dijkstrajs\.mjs/,
  "production deploy pins the exact QR dependency checksum");
assert.match(deploy, /sha256sum\s+-c/,
  "production deploy verifies vendor checksums before hosting");
assert.match(deploy, /sed[^\n]*dijkstrajs\.mjs/,
  "production deploy rewrites the generated QR bundle dependency to the local vendor file");
assert.match(sw, /\.\/profile-qr-renderer\.mjs/,
  "service worker caches the local QR renderer wrapper");
assert.match(sw, /\.\/vendor\/qrcode\.mjs/,
  "service worker caches the local QR ESM bundle");
assert.match(sw, /\.\/vendor\/dijkstrajs\.mjs/,
  "service worker caches the local QR dependency bundle");

console.log("profile QR local-renderer contract passed");
