import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveTheme } from "../appearance-accessibility-policy.mjs";

const root = new URL("../", import.meta.url);
const [css, bootstrap, controls, sw] = await Promise.all([
  readFile(new URL("appearance-accessibility.css", root), "utf8"),
  readFile(new URL("appearance-accessibility.js", root), "utf8"),
  readFile(new URL("controls.css", root), "utf8"),
  readFile(new URL("sw.js", root), "utf8")
]);

assert.equal(resolveTheme("system", false), "dark",
  "AnonChat system/default appearance stays dark even when desktop OS prefers light");
assert.equal(resolveTheme("system", true), "dark",
  "AnonChat system/default appearance stays dark when mobile OS prefers dark");
assert.equal(resolveTheme("light", true), "light",
  "an explicitly selected Light appearance remains available");

assert.match(css, /:root\s*\{[\s\S]*--ac-page-bg:\s*#0b0d12/i,
  "shared appearance defaults to the AnonChat dark page background");
assert.match(css, /body\s*\{[^}]*background-color:\s*var\(--ac-page-bg\)/s,
  "page background uses the shared appearance token before settings load");

const shellSurfaceRule = css.match(/\.topbar,\s*\n\.main-menu-panel\s*\{([^}]*)\}/)?.[1] || "";
assert.match(shellSurfaceRule, /background-color:\s*var\(--ac-surface\)/,
  "topbar and hamburger explicitly use the dark AnonChat surface before settings load");
assert.match(shellSurfaceRule, /color:\s*var\(--ac-text\)/,
  "topbar and hamburger explicitly use readable AnonChat text before settings load");

const broadBorderRule = css.match(/\.topbar,\s*\n\.main-menu-panel,\s*\n\.settings-card,[\s\S]*?\{([^}]*)\}/)?.[1] || "";
assert.match(broadBorderRule, /border-color:\s*var\(--ac-border\)/,
  "shared cards retain the appearance border token");
assert.doesNotMatch(broadBorderRule, /background-color:/,
  "default appearance must not force card/composer backgrounds over Premium customization");

const lightSurfaceRule = css.match(/html\[data-theme="light"\] \.topbar,[\s\S]*?\{([^}]*)\}/)?.[1] || "";
assert.match(lightSurfaceRule, /background-color:\s*var\(--ac-surface\)/,
  "explicit Light appearance continues to restyle shared surfaces through theme tokens");
assert.match(lightSurfaceRule, /color:\s*var\(--ac-text\)/,
  "explicit Light appearance keeps readable text through theme tokens");
assert.match(bootstrap, /ensureSharedStyles\(\);[\s\S]*onAuthStateChanged/,
  "shared appearance CSS is installed before asynchronous auth/settings resolution");
assert.match(controls, /\.main-menu-panel[^\n]*background:var\(--ac-menu-bg\)/,
  "hamburger controls remain tied to the existing AnonChat control theme");
assert.match(sw, /CACHE_NAME\s*=\s*["']anonchat-v141["']/,
  "service-worker cache advances so existing desktop and Android installs receive the accepted-conversation readiness correction");

console.log("desktop dark baseline and hamburger contrast contract passed");
