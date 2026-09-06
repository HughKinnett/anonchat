import assert from 'node:assert/strict';
import { appearanceClasses, resolveTheme } from '../appearance-accessibility-policy.mjs';

assert.equal(resolveTheme('dark', false), 'dark');
assert.equal(resolveTheme('light', true), 'light');
assert.equal(resolveTheme('system', true), 'dark');
assert.equal(resolveTheme('system', false), 'light');

assert.deepEqual(appearanceClasses({ theme: 'dark', textSize: 'default' }), [
  'theme-dark',
  'text-size-default'
]);
assert.deepEqual(appearanceClasses({
  theme: 'light',
  textSize: 'extra-large',
  reduceMotion: true,
  highContrast: true
}), [
  'theme-light',
  'text-size-extra-large',
  'reduce-motion',
  'high-contrast'
]);

for (const size of ['small', 'default', 'large', 'extra-large']) {
  assert.ok(appearanceClasses({ theme: 'dark', textSize: size }).includes(`text-size-${size}`));
}

console.log('appearance/accessibility policy tests passed');
