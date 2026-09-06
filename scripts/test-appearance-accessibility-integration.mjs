import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const applicator = await readFile(new URL('user-appearance.mjs', root), 'utf8');
const nav = await readFile(new URL('nav-menu.js', root), 'utf8');

assert.match(applicator, /appearance-accessibility-policy\.mjs/);
assert.match(applicator, /dataset\.theme/);
assert.match(applicator, /dataset\.textSize/);
assert.match(applicator, /classList\.toggle\(['"]reduce-motion['"]/);
assert.match(applicator, /classList\.toggle\(['"]high-contrast['"]/);
assert.match(applicator, /prefers-color-scheme/);
assert.match(applicator, /addEventListener\(['"]change['"]/);
assert.match(nav, /import\(['"]\.\/appearance-accessibility\.js['"]\)/,
  'shared hamburger bootstrap loads account appearance on primary app surfaces');

for (const page of ['timeline.html', 'profile.html', 'community.html', 'settings.html']) {
  const html = await readFile(new URL(page, root), 'utf8');
  assert.match(html, /nav-menu\.js/, `${page} loads the shared menu/bootstrap`);
}

const bootstrap = await readFile(new URL('appearance-accessibility.js', root), 'utf8').catch(() => '');
assert.match(bootstrap, /loadUserSettings/);
assert.match(bootstrap, /applyUserAppearance/);
assert.match(bootstrap, /onAuthStateChanged/);

console.log('appearance/accessibility integration tests passed');
