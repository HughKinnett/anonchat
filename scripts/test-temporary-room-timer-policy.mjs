import assert from "node:assert/strict";
import { formatDisappearsAt, nearestFutureExpiry, scheduleExpiryBoundary } from "../temporary-room-timer-policy.mjs";

const time = (value) => ({ toMillis: () => value });
assert.equal(nearestFutureExpiry([time(150), time(101), time(100), null], 100), 101);
assert.equal(nearestFutureExpiry([time(100), null], 100), null);
assert.equal(formatDisappearsAt(time(Date.UTC(2026, 7, 29, 12, 30)), "en-US", { timeZone: "UTC" }),
  "Disappears 8/29/2026, 12:30:00 PM");
assert.equal(formatDisappearsAt(null, "en-US", { timeZone: "UTC" }), "Disappearance time unavailable");

const scheduled = [];
let fired = 0;
const cancel = scheduleExpiryBoundary({
  expiries: [time(160), time(120)], nowMillis: 100,
  setTimeoutFn: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
  clearTimeoutFn: (id) => { scheduled[id - 1].cleared = true; },
  onBoundary: () => { fired += 1; }
});
assert.equal(scheduled[0].delay, 20, "the closest visible expiry schedules the sole boundary timer");
scheduled[0].callback();
assert.equal(fired, 1);
cancel();
assert.equal(scheduled[0].cleared, true);
console.log("Temporary room timer policy passed");
