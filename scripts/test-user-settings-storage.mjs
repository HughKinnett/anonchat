import assert from 'node:assert/strict';
import { userSettingsPath } from '../user-settings-storage.mjs';

const path = userSettingsPath('user-123');
assert.deepEqual(path, ['users', 'user-123', 'private', 'settings']);
assert.equal(path.length % 2, 0, 'Firestore document paths must contain an even number of segments');

console.log('user settings storage path tests passed');
