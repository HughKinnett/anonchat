import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const nav = await readFile(new URL('../nav-menu.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../settings.html', import.meta.url), 'utf8').catch(() => '');
const js = await readFile(new URL('../settings.js', import.meta.url), 'utf8').catch(() => '');

assert.match(nav, /settings\.html/);
assert.match(nav, /Settings/);
assert.match(html, /Privacy & Messaging/);
assert.match(html, /Notifications/);
assert.match(html, /Appearance/);
assert.match(html, /Accessibility/);
assert.match(html, /id="message-request-mode"/);
assert.match(html, /id="pause-all-notifications"/);
assert.match(html, /id="quiet-hours-enabled"/);
assert.match(html, /id="theme-setting"/);
assert.match(html, /id="reduce-motion-setting"/);
assert.match(html, /id="text-size-setting"/);
assert.match(html, /id="high-contrast-setting"/);
assert.match(js, /loadUserSettings/);
assert.match(js, /saveUserSettings/);
assert.match(js, /applyUserAppearance/);
assert.match(js, /onAuthStateChanged/);

console.log('Settings page integration tests passed');
