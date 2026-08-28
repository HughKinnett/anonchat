import assert from "node:assert/strict";
import { markNotificationsSeen, readSeenNotificationIds } from "../notification-storage.mjs";

const throwingStorage = {
  getItem() { throw new DOMException("storage blocked", "SecurityError"); },
  setItem() { throw new DOMException("storage blocked", "SecurityError"); }
};
assert.deepEqual([...readSeenNotificationIds({ storage: throwingStorage, uid: "user-a" })], [], "a SecurityError during startup becomes an empty seen set");

const corruptStorage = {
  getItem: () => "{not-json",
  setItem: () => { throw new Error("not used"); }
};
assert.deepEqual([...readSeenNotificationIds({ storage: corruptStorage, uid: "user-a" })], [], "corrupt JSON cannot break authentication startup");

const wrongShapeStorage = {
  getItem: () => JSON.stringify({ messageContent: "not an ID list" }),
  setItem: () => { throw new Error("not used"); }
};
assert.deepEqual([...readSeenNotificationIds({ storage: wrongShapeStorage, uid: "user-a" })], [], "non-array JSON cannot poison notification rendering");

const validStorage = {
  getItem: () => JSON.stringify(["notification-a", 42, "notification-b", "notification-a"]),
  setItem: () => { throw new Error("not used"); }
};
assert.deepEqual([...readSeenNotificationIds({ storage: validStorage, uid: "user-a" })], ["notification-a", "notification-b"], "only string notification IDs are restored");

const seen = new Set(["notification-a"]);
assert.doesNotThrow(() => markNotificationsSeen({
  storage: throwingStorage,
  uid: "user-a",
  seenIds: seen,
  currentIds: ["notification-b", "notification-c"]
}), "the in-app bell remains usable when storage writes throw");
assert.deepEqual([...seen], ["notification-a", "notification-b", "notification-c"], "bell state updates in memory even when persistence is unavailable");

let stored;
markNotificationsSeen({
  storage: { getItem: () => null, setItem: (key, value) => { stored = { key, value }; } },
  uid: "user-a",
  seenIds: new Set(),
  currentIds: ["notification-a"]
});
assert.deepEqual(stored, {
  key: "anonchat-seen-notifications-user-a",
  value: JSON.stringify(["notification-a"])
});

console.log("Timeline notification storage safety passed");
