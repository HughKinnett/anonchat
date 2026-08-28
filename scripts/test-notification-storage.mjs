import assert from "node:assert/strict";
import { markNotificationsSeen, readSeenNotificationIds } from "../notification-storage.mjs";

const throwingStorage = {
  getItem() { throw new DOMException("storage blocked", "SecurityError"); },
  setItem() { throw new DOMException("storage blocked", "SecurityError"); }
};
assert.deepEqual([...readSeenNotificationIds({ getStorage: () => throwingStorage, uid: "user-a" })], [], "a SecurityError during startup becomes an empty seen set");

let throwingGetterReads = 0;
const throwingWindow = Object.defineProperty({}, "localStorage", {
  get() {
    throwingGetterReads += 1;
    throw new DOMException("storage getter blocked", "SecurityError");
  }
});
assert.deepEqual([...readSeenNotificationIds({ getStorage: () => throwingWindow.localStorage, uid: "user-a" })], [], "a throwing window.localStorage getter cannot break startup");
assert.equal(throwingGetterReads, 1, "startup acquires storage lazily inside the safe helper");

const corruptStorage = {
  getItem: () => "{not-json",
  setItem: () => { throw new Error("not used"); }
};
assert.deepEqual([...readSeenNotificationIds({ getStorage: () => corruptStorage, uid: "user-a" })], [], "corrupt JSON cannot break authentication startup");

const wrongShapeStorage = {
  getItem: () => JSON.stringify({ messageContent: "not an ID list" }),
  setItem: () => { throw new Error("not used"); }
};
assert.deepEqual([...readSeenNotificationIds({ getStorage: () => wrongShapeStorage, uid: "user-a" })], [], "non-array JSON cannot poison notification rendering");

const validStorage = {
  getItem: () => JSON.stringify(["notification-a", 42, "notification-b", "notification-a"]),
  setItem: () => { throw new Error("not used"); }
};
assert.deepEqual([...readSeenNotificationIds({ getStorage: () => validStorage, uid: "user-a" })], ["notification-a", "notification-b"], "only string notification IDs are restored");

const seen = new Set(["notification-a"]);
assert.doesNotThrow(() => markNotificationsSeen({
  getStorage: () => throwingStorage,
  uid: "user-a",
  seenIds: seen,
  currentIds: ["notification-b", "notification-c"]
}), "the in-app bell remains usable when storage writes throw");
assert.deepEqual([...seen], ["notification-a", "notification-b", "notification-c"], "bell state updates in memory even when persistence is unavailable");

const getterSeen = new Set();
assert.doesNotThrow(() => markNotificationsSeen({
  getStorage: () => throwingWindow.localStorage,
  uid: "user-a",
  seenIds: getterSeen,
  currentIds: ["notification-from-bell"]
}), "a throwing window.localStorage getter cannot break the bell");
assert.equal(throwingGetterReads, 2, "bell storage acquisition is lazy and wrapped");
assert.deepEqual([...getterSeen], ["notification-from-bell"], "bell state still updates in memory when the storage getter throws");

let stored;
markNotificationsSeen({
  getStorage: () => ({ getItem: () => null, setItem: (key, value) => { stored = { key, value }; } }),
  uid: "user-a",
  seenIds: new Set(),
  currentIds: ["notification-a"]
});
assert.deepEqual(stored, {
  key: "anonchat-seen-notifications-user-a",
  value: JSON.stringify(["notification-a"])
});

console.log("Timeline notification storage safety passed");
