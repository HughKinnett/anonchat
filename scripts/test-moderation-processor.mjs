import assert from "node:assert/strict";
import { processModeration } from "../moderation-processor.mjs";

class Adapter {
  constructor() { this.clock = 10; this.heartbeats = []; this.intakes = ["a", "b"]; this.actions = ["c"]; this.rooms = ["r"]; this.calls = []; }
  now() { return this.clock; }
  async heartbeat(status, errorCode) { this.heartbeats.push([status, errorCode]); }
  async backfillModerationState() { this.calls.push(["backfill"]); return { migrated: 0 }; }
  async scanIntakesPage(cursor, runCutoff) { this.scanCutoff = runCutoff; return cursor ? { items: [] } : { items: this.intakes.map((id) => ({ id })), nextCursor: "a" }; }
  async claimIntake(id) { return { id, token: `i-${id}` }; }
  async processClaimedIntake(id, token) { this.calls.push(["intake", id, token]); }
  async failIntake(id, token, code) { this.calls.push(["intake-failed", id, token, code]); }
  async scanActionsPage(cursor) { return cursor ? { items: [] } : { items: this.actions.map((id) => ({ id })), nextCursor: "c" }; }
  async claimAction(id) { return { id, token: `a-${id}` }; }
  async executeClaimedAction(id, token) { this.calls.push(["action", id, token]); }
  async failAction(id, token, code) { this.calls.push(["action-failed", id, token, code]); }
  async scanLegacyRoomQueuePage() { return { items: [] }; }
  async scanExpiredRoomsPage(cursor, runCutoff) { this.roomScanCutoff = runCutoff; return cursor ? { items: [] } : { items: this.rooms.map((id) => ({ id })), nextCursor: "r" }; }
  async cleanupExpiredRoom(id, options) { this.calls.push(["room", id]); this.cleanupOptions = options; return true; }
}
const adapter = new Adapter();
const result = await processModeration(adapter, { ownerId: "worker" });
assert.deepEqual(result, { inspected: 3, processed: 3, failed: 0, skipped: 0, terminalIntakes: 0, terminalActions: 0, expiredRooms: 1, backfilled: 0, roomLifecycleMigrated: 0, roomLifecycleQuarantined: 0, roomLifecycleDeferred: 0, legacyRoomsCleaned: 0, legacyRoomsManualReview: 0 });
assert.deepEqual(adapter.calls, [["backfill"], ["intake", "a", "i-a"], ["intake", "b", "i-b"], ["action", "c", "a-c"], ["room", "r"]]);
assert.equal(adapter.scanCutoff, 10);
assert.equal(adapter.roomScanCutoff, 10);
assert.deepEqual(adapter.cleanupOptions, { ownerId: "worker", runCutoff: 10 });
assert.deepEqual(adapter.heartbeats, [["started", undefined], ["completed", undefined]]);

class DryRunAdapter extends Adapter {
  constructor() { super(); this.intakes = []; this.actions = []; this.rooms = []; }
}
const dryRun = new DryRunAdapter();
assert.deepEqual(await processModeration(dryRun, { dryRun: true }), { inspected: 0, processed: 0, failed: 0, skipped: 0, terminalIntakes: 0, terminalActions: 0, expiredRooms: 0, backfilled: 0, roomLifecycleMigrated: 0, roomLifecycleQuarantined: 0, roomLifecycleDeferred: 0, legacyRoomsCleaned: 0, legacyRoomsManualReview: 0 });
assert.deepEqual(dryRun.heartbeats, [["started", undefined], ["completed", undefined]], "dry runs refresh the heartbeat");
class HeartbeatFailureAdapter extends DryRunAdapter { async heartbeat() { throw new Error("storage failure"); } }
await assert.rejects(() => processModeration(new HeartbeatFailureAdapter(), { dryRun: true, logger: { error() {} } }), (error) => error.code === "heartbeat-failed");
class RoomRaceAdapter extends DryRunAdapter {
  constructor() { super(); this.rooms = ["gone", "stale"]; }
  async scanExpiredRoomsPage(cursor) { return cursor ? { items: [] } : { items: this.rooms.map((id) => ({ id })), nextCursor: "stale" }; }
  async cleanupExpiredRoom(id) { return id === "stale"; }
}
assert.equal((await processModeration(new RoomRaceAdapter(), { logger: { error() {} } })).expiredRooms, 1, "only physical room deletion increments the summary");

class DeferredLifecycleAdapter extends DryRunAdapter {
  constructor({ leased = false } = {}) { super(); this.intakes = ["evidence"]; this.rooms = ["expired"]; this.leased = leased; this.lifecycleCalls = 0; }
  async claimIntake() { return this.leased ? null : { id: "evidence", token: "lease" }; }
  async processClaimedIntake() { throw new Error("retry later"); }
  async backfillRoomLifecycle() { this.lifecycleCalls += 1; return { migrated: 1 }; }
  async cleanupExpiredRoom() { throw new Error("must not clean authoritative evidence"); }
}
for (const options of [{}, { leased: true }]) {
  const deferred = new DeferredLifecycleAdapter(options);
  const result = await processModeration(deferred, { logger: { error() {} } });
  assert.equal(result.roomLifecycleMigrated, 0, "unsettled moderation defers lifecycle migration");
  assert.equal(result.expiredRooms, 0, "unsettled moderation defers expired-room cleanup");
  assert.equal(deferred.lifecycleCalls, 0);
}

class TerminalSettlementAdapter extends DryRunAdapter {
  constructor() { super(); this.intakes = ["terminal-poison"]; this.rooms = ["expired"]; this.lifecycleCalls = 0; }
  async claimIntake() { return null; }
  async settleTerminalIntake(id) { return id === "terminal-poison"; }
  async backfillRoomLifecycle() { this.lifecycleCalls += 1; return { migrated: 0, quarantined: 0 }; }
  async cleanupExpiredRoom() { return true; }
}
const terminal = await processModeration(new TerminalSettlementAdapter(), { logger: { error() {} } });
assert.equal(terminal.terminalIntakes, 1, "terminal poison is explicitly settled");
assert.equal(terminal.roomLifecycleDeferred, 0, "settled terminal poison does not gate unrelated cleanup");
assert.equal(terminal.expiredRooms, 1);

class TerminalLegacyRoomAdapter extends DryRunAdapter {
  async scanLegacyRoomQueuePage(cursor) { return cursor ? { items: [] } : { items: [{ id: "legacy-poison" }], nextCursor: "legacy-poison" }; }
  async claimLegacyRoom() { return null; }
  async settleTerminalLegacyRoom(id) { return id === "legacy-poison"; }
}
const legacyTerminal = await processModeration(new TerminalLegacyRoomAdapter(), { logger: { error() {} } });
assert.equal(legacyTerminal.legacyRoomsManualReview, 1, "an exhausted abandoned legacy-room lease reaches terminal manual review");

class FatalRoomLifecycleAdapter extends DryRunAdapter {
  async backfillRoomLifecycle() { throw Object.assign(new Error("private Firestore detail"), { code: 9 }); }
}
const fatalLog = [];
await assert.rejects(() => processModeration(new FatalRoomLifecycleAdapter(), {
  logger: { error(code) { fatalLog.push(code); } }
}), (error) => error.code === 9);
assert.deepEqual(fatalLog, ["FIRESTORE_FAILED_PRECONDITION"], "fatal logs contain only an allowlisted operational code");
console.log("Moderation processor passed");
