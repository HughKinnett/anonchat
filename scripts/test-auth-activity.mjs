import assert from "node:assert/strict";
import { chooseDurablePersistence } from "../auth-persistence-policy.mjs";
import {
  ACTIVITY_WRITE_INTERVAL_MS,
  activityStatus,
  isActivityWriteDue
} from "../activity-policy.mjs";
import { recordDailyActivity } from "../activity.js";
import { runAccessActivityGate } from "../access-activity-gate.mjs";

const auth = { uid: "user-a" };
const local = { name: "local" };
const session = { name: "session" };

const localCalls = [];
await chooseDurablePersistence(async (_auth, candidate) => localCalls.push(candidate), auth, [local, session]);
assert.deepEqual(localCalls, [local], "local persistence succeeds without trying session persistence");

const fallbackCalls = [];
await chooseDurablePersistence(async (_auth, candidate) => {
  fallbackCalls.push(candidate);
  if (candidate === local) throw new Error("local storage blocked");
}, auth, [local, session]);
assert.deepEqual(fallbackCalls, [local, session], "session persistence follows a local storage failure");

await assert.rejects(
  chooseDurablePersistence(async () => { throw new Error("storage blocked"); }, auth, [local, session]),
  (error) => error.code === "auth/storage-unavailable",
  "both durable stores failing produces the durable-storage error"
);

const now = 10 * ACTIVITY_WRITE_INTERVAL_MS;
assert.equal(activityStatus(undefined, now), "unknown", "a missing activity timestamp is unknown");
assert.equal(activityStatus({ toMillis: () => now - 23 * 60 * 60 * 1000 }, now), "active", "23-hour-old activity is active");
assert.equal(activityStatus({ toMillis: () => now - 7 * 24 * 60 * 60 * 1000 }, now), "active", "activity stays active through seven full days");
assert.equal(activityStatus({ toMillis: () => now - 7 * 24 * 60 * 60 * 1000 - 1 }, now), "inactive", "activity becomes inactive after seven full days");
assert.equal(isActivityWriteDue({ toMillis: () => now - 23 * 60 * 60 * 1000 }, now), false, "23-hour-old activity is not due");
assert.equal(isActivityWriteDue({ toMillis: () => now - ACTIVITY_WRITE_INTERVAL_MS }, now), true, "24-hour-old activity is due");

let writes = 0;
assert.deepEqual(
  await recordDailyActivity({ lastActiveAt: undefined, now: () => now, writeLastActiveAt: async () => { writes += 1; } }),
  { due: true, written: true },
  "the injected writer records a missing timestamp"
);
assert.equal(writes, 1);
assert.deepEqual(
  await recordDailyActivity({
    lastActiveAt: { toMillis: () => now - 23 * 60 * 60 * 1000 },
    now: () => now,
    writeLastActiveAt: async () => { writes += 1; }
  }),
  { due: false, written: false },
  "the injected writer is not called before the daily interval"
);
assert.equal(writes, 1);

let gateWrites = 0;
assert.deepEqual(
  await runAccessActivityGate({ profile: null, recordActivity: async () => { gateWrites += 1; } }),
  { allowed: false, reason: "missing-profile" },
  "a missing profile cannot record activity"
);
assert.deepEqual(
  await runAccessActivityGate({ profile: { banned: true }, recordActivity: async () => { gateWrites += 1; } }),
  { allowed: false, reason: "banned" },
  "a banned profile cannot record activity"
);
assert.deepEqual(
  await runAccessActivityGate({
    profile: { username: "not-admin" },
    requireAdmin: true,
    isAuthorizedAdmin: false,
    recordActivity: async () => { gateWrites += 1; }
  }),
  { allowed: false, reason: "unauthorized-admin" },
  "an unauthorized admin visitor cannot record activity"
);
assert.deepEqual(
  await runAccessActivityGate({
    profile: { username: "member" },
    recordActivity: async () => { gateWrites += 1; }
  }),
  { allowed: true, activityWritten: true },
  "an accepted visitor records activity"
);
assert.equal(gateWrites, 1);
assert.deepEqual(
  await runAccessActivityGate({
    profile: { username: "member" },
    recordActivity: async () => { throw new Error("rules rejected write"); }
  }),
  { allowed: true, activityWritten: false },
  "a rejected activity write does not block accepted access"
);

console.log("durable auth and activity policies passed");
