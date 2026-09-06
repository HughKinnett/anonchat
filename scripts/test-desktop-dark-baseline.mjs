import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [css, bootstrap, controls] = await Promise.all([
  readFile(new URL("appearance-accessibility.css", root), "utf8"),
  readFile(new URL("appearance-accessibility.js", root), "utf8"),
  readFile(new URL("controls.css", root), "utf8")
]);

assert.match(css, /:root\s*\{[\s\S]*--ac-page-bg:\s*#0b0d12/i,
  "shared appearance defaults to the AnonChat dark page background");
assert.match(css, /body\s*\{[^}]*background-color:\s*var\(--ac-page-bg\)/s,
  "page background uses the shared appearance token before settings load");
assert.match(css, /\.main-menu-panel[\s\S]{0,500}background-color:\s*var\(--ac-surface\)/,
  "hamburger panel has an explicit dark default surface");
assert.match(css, /\.main-menu-panel[\s\S]{0,500}color:\s*var\(--ac-text\)/,
  "hamburger panel has an explicit readable default foreground");
assert.match(css, /html\[data-theme="light"\][\s\S]*\.main-menu-panel[\s\S]*background-color:\s*var\(--ac-surface\)/,
  "explicit Light appearance continues to restyle the hamburger panel through theme tokens");
assert.match(bootstrap, /ensureSharedStyles\(\);[\s\S]*onAuthStateChanged/,
  "shared appearance CSS is installed before asynchronous auth/settings resolution");
assert.match(controls, /\.main-menu-panel[^\n]*background:var\(--ac-menu-bg\)/,
  "hamburger controls remain tied to the existing AnonChat control theme");

console.log("desktop dark baseline and hamburger contrast contract passed");
