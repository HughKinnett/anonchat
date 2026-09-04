import assert from "node:assert/strict";
import {
  TrustedDeviceStateError,
  createPinAttemptTracker,
  loadTrustedDeviceRecord,
  removeTrustedDeviceRecord,
  saveTrustedDeviceRecord
} from "../e2ee-device-store.mjs";
import { trustedDeviceStorageKey } from "../e2ee-pin.mjs";

class MapStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}

const storage = new MapStorage();
saveTrustedDeviceRecord(storage, "user-a", { version: 1, ciphertext: "a" });
saveTrustedDeviceRecord(storage, "user-b", { version: 1, ciphertext: "b" });
assert.deepEqual(loadTrustedDeviceRecord(storage, "user-a"), { version: 1, ciphertext: "a" });
assert.deepEqual(loadTrustedDeviceRecord(storage, "user-b"), { version: 1, ciphertext: "b" });
removeTrustedDeviceRecord(storage, "user-a");
assert.equal(loadTrustedDeviceRecord(storage, "user-a"), null);
assert.deepEqual(loadTrustedDeviceRecord(storage, "user-b"), { version: 1, ciphertext: "b" });
storage.setItem(trustedDeviceStorageKey("broken"), "not-json");
assert.throws(() => loadTrustedDeviceRecord(storage, "broken"), TrustedDeviceStateError);

let now = 1000;
const tracker = createPinAttemptTracker({ now: () => now });
assert.equal(tracker.remainingDelay("user"), 0);
assert.equal(tracker.recordFailure("user"), 1000);
assert.equal(tracker.remainingDelay("user"), 1000);
now += 1000;
assert.equal(tracker.remainingDelay("user"), 0);
assert.equal(tracker.recordFailure("user"), 2000);
tracker.recordSuccess("user");
assert.equal(tracker.remainingDelay("user"), 0);

console.log("E2EE trusted-device storage lifecycle passed.");
