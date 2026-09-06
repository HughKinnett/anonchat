import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, phaseA, deploy, sw] = await Promise.all([
  readFile(new URL("profile.html", root), "utf8"),
  readFile(new URL("profile-phase-a.js", root), "utf8"),
  readFile(new URL(".github/workflows/deploy-firebase.yml", root), "utf8"),
  readFile(new URL("sw.js", root), "utf8")
]);

assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/npm\/qrcode/i,
  "profile QR has no runtime CDN dependency");
assert.match(html, /<script src="vendor\/qrcode\.min\.js"><\/script>/,
  "profile loads the AnonChat-hosted QR renderer before profile bootstrap");
assert.match(phaseA, /globalThis\.QRCode\?\.toCanvas/,
  "profile QR controller uses the staged local QR renderer API");
assert.match(deploy, /qrcode@1\.5\.4\/build\/qrcode\.min\.js/,
  "production deploy pins the approved QR renderer version");
assert.match(deploy, /vendor\/qrcode\.min\.js/,
  "production deploy stages the QR renderer into the hosted vendor path");
assert.match(deploy, /[a-f0-9]{64}\s+vendor\/qrcode\.min\.js[\s\S]*sha256sum\s+-c/,
  "production deploy verifies the exact QR bundle checksum before hosting it");
assert.match(sw, /\.\/vendor\/qrcode\.min\.js/,
  "service worker caches the locally hosted QR renderer");

console.log("profile QR local-renderer contract passed");
