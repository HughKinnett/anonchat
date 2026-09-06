import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, phaseA, renderer, firebaseConfig, staging, sw] = await Promise.all([
  readFile(new URL("profile.html", root), "utf8"),
  readFile(new URL("profile-phase-a.js", root), "utf8"),
  readFile(new URL("profile-qr-renderer.mjs", root), "utf8"),
  readFile(new URL("firebase.json", root), "utf8"),
  readFile(new URL("scripts/stage-qr-vendor.mjs", root), "utf8"),
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
assert.match(firebaseConfig, /"predeploy"\s*:\s*"node scripts\/stage-qr-vendor\.mjs"/,
  "Firebase Hosting stages the pinned QR bundles before deployment");
assert.match(staging, /https:\/\/cdn\.jsdelivr\.net\/npm\/qrcode@1\.5\.4\/\+esm/,
  "QR staging pins the approved QR ESM source");
assert.match(staging, /https:\/\/cdn\.jsdelivr\.net\/npm\/dijkstrajs@1\.0\.3\/\+esm/,
  "QR staging pins the QR dependency source");
assert.match(staging, /f712a06862e06fdbb45fc846f9ad273624835025d8c4657c139a0d678d2d3733/,
  "QR staging pins the exact QR bundle checksum");
assert.match(staging, /62dc939c7c6d5b83a148931d0852d636a15f9d414023c1032647adcac06a4123/,
  "QR staging pins the exact QR dependency checksum");
assert.match(staging, /createHash\(["']sha256["']\)/,
  "QR staging verifies vendor checksums before writing Hosting files");
assert.match(staging, /replaceAll\([^\n]*dijkstrajs\.mjs/,
  "QR staging rewrites the generated QR bundle dependency to the local vendor file");
assert.match(sw, /\.\/profile-qr-renderer\.mjs/,
  "service worker caches the local QR renderer wrapper");
assert.match(sw, /\.\/vendor\/qrcode\.mjs/,
  "service worker caches the local QR ESM bundle");
assert.match(sw, /\.\/vendor\/dijkstrajs\.mjs/,
  "service worker caches the local QR dependency bundle");

console.log("profile QR local-renderer contract passed");
