import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isDesignatedAdmin } from '../designated-admin-policy.mjs';

assert.equal(isDesignatedAdmin('TestAccount'), true, 'TestAccount must be recognized by profile/timeline admin-button policy');
assert.equal(isDesignatedAdmin('testaccount'), true, 'admin-button policy must be case-insensitive');
assert.equal(isDesignatedAdmin('ordinary_user'), false, 'ordinary users must not receive an Admin button');

const profile = fs.readFileSync(new URL('../profile.js', import.meta.url), 'utf8');
const timeline = fs.readFileSync(new URL('../timeline.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
assert.match(profile, /profile-admin-link[\s\S]{0,250}isDesignatedAdmin|isDesignatedAdmin[\s\S]{0,400}profile-admin-link/, 'profile uses designated admin policy for Admin button');
assert.match(timeline, /admin-link[\s\S]{0,250}isDesignatedAdmin|isDesignatedAdmin[\s\S]{0,400}admin-link/, 'timeline uses designated admin policy for Admin button');
assert.match(sw, /anonchat-v144/, 'service-worker cache must be bumped for updated admin policy');
