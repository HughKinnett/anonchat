import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chooseDurablePersistence } from "../auth-persistence-policy.mjs";
import {
  ACTIVITY_WRITE_INTERVAL_MS,
  activityStatus,
  isActivityWriteDue
} from "../activity-policy.mjs";
import { recordDailyActivity } from "../activity.js";
import { runAccessActivityGate } from "../access-activity-gate.mjs";
import { recordPageActivity, signedInActivitySurfaces } from "../activity-integration.mjs";

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
assert.equal(isActivityWriteDue({ toMillis: () => now - ACTIVITY_WRITE_INTERVAL_MS }, now), true, "the deterministic 24-hour boundary is inclusive");

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

assert.deepEqual(
  Object.keys(signedInActivitySurfaces).sort(),
  ["admin", "community", "connections", "delete-account", "profile", "timeline"],
  "the shared activity manifest covers every signed-in surface"
);
assert.equal(signedInActivitySurfaces.admin.requireAdmin, true, "the admin surface requires authorization");

let pageActivityWrite;
assert.deepEqual(
  await recordPageActivity({
    surface: "timeline",
    profile: {},
    user: { uid: "user-a" },
    db: { name: "db" },
    firestore: {
      doc: (...parts) => parts,
      updateDoc: async (reference, data) => { pageActivityWrite = { reference, data }; },
      serverTimestamp: () => "server-time"
    }
  }),
  { allowed: true, activityWritten: true },
  "the shared production contract records accepted page activity"
);
assert.deepEqual(pageActivityWrite, {
  reference: [{ name: "db" }, "users", "user-a"],
  data: { lastActiveAt: "server-time" }
}, "the shared production writer changes only lastActiveAt");

const loginSource = await readFile(new URL("../loginfirebase.js", import.meta.url), "utf8");
assert.match(loginSource, /chooseDurablePersistence/, "login uses the durable persistence policy");
assert.doesNotMatch(loginSource, /inMemoryPersistence/, "login has no memory-only persistence fallback");
const rulesSource = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
assert.match(
  rulesSource,
  /request\.time\s*-\s*resource\.data\.lastActiveAt\s*>=\s*duration\.value\(24,\s*'h'\)/,
  "the Firestore commit rule uses the same inclusive 24-hour boundary"
);

for (const [surface, filename] of Object.entries({
  timeline: "timeline.js",
  profile: "profile.js",
  community: "community.js",
  connections: "connections.js",
  "delete-account": "delete-account.js",
  admin: "admin.js"
})) {
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  assert.match(source, /recordPageActivity/, `${filename} imports the shared page activity contract`);
  assert.match(source, new RegExp(`surface\\s*:\\s*["']${surface}["']`), `${filename} identifies its manifest surface`);
}

console.log("durable auth and activity policies passed");
