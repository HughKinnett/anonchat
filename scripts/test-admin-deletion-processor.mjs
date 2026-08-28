import assert from "node:assert/strict";
import { runDeletionProcessor, scanPages } from "../admin-deletion-processor.mjs";
const queuedJob = (targetUid, overrides = {}) => ({ id: targetUid, data: { targetUid, requesterUid: "admin", requestedAt: 1_000, status: "queued", ...overrides } });
class MemoryAdapter {
  constructor(jobs, options = {}) {
    this.jobs = new Map(jobs.map((job) => [job.id, structuredClone(job.data)])); this.options = options; this.writes = [];
    this.auth = new Set(jobs.map((job) => job.id)); this.linked = new Map(jobs.map((job) => [job.id, new Set(["profile", "post", "follow"])]));
    this.accountCount = jobs.length; this.clock = 10_000; this.secondSweepCalls = 0;
  }
  async listJobs() { return [...this.jobs].map(([id, data]) => ({ id, data: structuredClone(data) })); }
  async listExpiredMarkers() { return [...this.jobs].filter(([, data]) => data.status === "completed" && data.purgeAfter <= this.clock).map(([id, data]) => ({ id, data: structuredClone(data) })); }
  page(values, cursor) {
    const sorted = values.sort(([left], [right]) => left.localeCompare(right));
    const after = cursor ? sorted.findIndex(([id]) => id > cursor) : 0;
    const start = after < 0 ? sorted.length : after;
    const selected = sorted.slice(start, start + 200);
    return { items: selected.map(([id, data]) => ({ id, data: structuredClone(data) })), nextCursor: selected.at(-1)?.[0] };
  }
  async scanJobsPage(cursor) { return this.page([...this.jobs].filter(([, data]) => ["queued", "failed", "processing"].includes(data.status)), cursor); }
  async scanMarkersPage(cursor) { return this.page([...this.jobs].filter(([, data]) => data.status === "completed"), cursor); }
  async preview(job) { return job.data.status === "queued"; }
  async heartbeat(state, code) { if (this.options.heartbeatFails) throw Object.assign(new Error(), { code: "heartbeat-failed" }); this.writes.push(["heartbeat", state, code]); }
  async claim(id, owner) {
    const job = this.jobs.get(id);
    if (!job || (!["queued", "failed"].includes(job.status) && !(job.status === "processing" && job.leaseExpiresAt <= this.clock))) return null;
    if (this.options.untrusted?.has(id)) throw Object.assign(new Error(), { code: "untrusted-requester" });
    if (this.options.protected?.has(id)) throw Object.assign(new Error(), { code: "protected-target" });
    const token = `${owner}-${(job.attempts || 0) + 1}`;
    Object.assign(job, { status: "processing", leaseToken: token, leaseExpiresAt: this.clock + 100, attempts: (job.attempts || 0) + 1, phase: job.phase || "claimed" });
    this.writes.push(["claim", id]); return { targetUid: id, token, phase: job.phase };
  }
  assertLease(id, token) { const job = this.jobs.get(id); if (!job || job.leaseToken !== token || job.status !== "processing") throw Object.assign(new Error(), { code: "lease-lost" }); }
  async firstSweep(id, token) { this.assertLease(id, token); this.linked.get(id).delete("post"); this.linked.get(id).delete("follow"); this.jobs.get(id).phase = "first-sweep"; }
  async removeProfileBarrier(id, token) { this.assertLease(id, token); const job = this.jobs.get(id); if (job.phase !== "profile-barrier") { this.linked.get(id).delete("profile"); this.accountCount -= 1; job.phase = "profile-barrier"; } }
  async secondSweep(id, token) { this.assertLease(id, token); this.secondSweepCalls += 1; if (this.options.injectDuringSecondSweep && this.secondSweepCalls === 1) this.linked.get(id).add("late"); this.linked.get(id).clear(); this.jobs.get(id).phase = "second-sweep"; }
  async beginAuthDeletion(id, token) { this.assertLease(id, token); this.jobs.get(id).phase = "auth-deleting"; this.jobs.get(id).leaseExpiresAt = this.clock + 100; this.writes.push(["auth-begin"]); }
  async deleteAuth(id, token) { this.assertLease(id, token); this.writes.push(["auth-call"]); if (this.options.loseLeaseDuringAuth?.has(id)) { this.jobs.get(id).leaseToken = "new-owner"; throw Object.assign(new Error(), { code: "lease-lost" }); } if (this.options.failAuthOnce?.has(id)) { this.options.failAuthOnce.delete(id); throw Object.assign(new Error(), { code: "auth/internal-error" }); } this.auth.delete(id); }
  async finishAuthDeletion(id, token) { this.assertLease(id, token); this.jobs.get(id).phase = "auth-deleted"; this.writes.push(["auth-finish"]); }
  async finalize(id, token, completedAt, purgeAfter) { this.assertLease(id, token); if (this.options.recreateProfileBeforeFinalize?.has(id)) this.linked.get(id).add("profile"); if (this.linked.get(id).has("profile")) throw Object.assign(new Error(), { code: "profile-recreated" }); this.jobs.set(id, { status: "completed", completedAt, purgeAfter }); }
  async fail(id, token, code) { const job = this.jobs.get(id); if (job?.leaseToken === token) Object.assign(job, { status: "failed", errorCode: code, leaseExpiresAt: this.clock }); this.writes.push(["fail", code]); }
  async purgeMarker(id) { this.jobs.delete(id); }
  timestamp(milliseconds) { return milliseconds; } now() { return this.clock; }
}
class PagedMemoryAdapter extends MemoryAdapter {
  constructor(jobs, markers = []) {
    super(jobs);
    this.markerDocs = new Map(markers.map((marker) => [marker.id, structuredClone(marker.data)]));
    this.listJobs = undefined;
    this.listExpiredMarkers = undefined;
  }
  async scanJobsPage(cursor) { return this.page([...this.jobs].filter(([, data]) => ["queued", "failed", "processing"].includes(data.status)), cursor); }
  async scanMarkersPage(cursor) { return this.page([...this.markerDocs], cursor); }
  async purgeMarker(id) { this.markerDocs.delete(id); }
}
const captureLogger = () => { const entries = []; return { entries, logger: { info: (code) => entries.push(code), error: (code) => entries.push(code) } }; };
{
  const values = Array.from({ length: 405 }, (_, index) => `job-${String(index).padStart(3, "0")}`);
  const pages = [];
  for await (const page of scanPages(async (cursor) => {
    const start = cursor ? values.indexOf(cursor) + 1 : 0;
    const items = values.slice(start, start + 200);
    pages.push(items.length);
    return { items, nextCursor: items.at(-1) };
  })) assert.ok(page.length <= 200);
  assert.deepEqual(pages, [200, 200, 5, 0]);
}
{
  const adapter = new MemoryAdapter([queuedJob("dry-target")]);
  const result = await runDeletionProcessor({ adapter, ownerId: "worker", dryRun: true, logger: captureLogger().logger });
  assert.deepEqual(result, { inspected: 1, processed: 0, failed: 0, skipped: 0, purged: 0 }); assert.equal(adapter.writes.length, 0);
}
{
  const adapter = new MemoryAdapter([queuedJob("active", { status: "processing", leaseExpiresAt: 20_000 }), queuedJob("stale", { status: "processing", leaseExpiresAt: 9_000 }), queuedJob("queued")]);
  const result = await runDeletionProcessor({ adapter, ownerId: "worker", logger: captureLogger().logger });
  assert.equal(result.skipped, 1); assert.equal(result.processed, 2);
}
{
  const adapter = new MemoryAdapter([queuedJob("retry")], { failAuthOnce: new Set(["retry"]), injectDuringSecondSweep: true });
  const first = await runDeletionProcessor({ adapter, ownerId: "a", logger: captureLogger().logger });
  assert.equal(first.failed, 1); assert.equal(adapter.accountCount, 0); assert.equal(adapter.linked.get("retry").size, 0);
  const second = await runDeletionProcessor({ adapter, ownerId: "b", logger: captureLogger().logger });
  assert.equal(second.processed, 1); assert.equal(adapter.accountCount, 0);
  assert.deepEqual(Object.keys(adapter.jobs.get("retry")).sort(), ["completedAt", "purgeAfter", "status"]);
  assert.equal(adapter.jobs.get("retry").purgeAfter - adapter.jobs.get("retry").completedAt, 7_200_000);
  assert.deepEqual(adapter.writes.filter(([code]) => code.startsWith("auth")), [["auth-begin"], ["auth-call"], ["auth-begin"], ["auth-call"], ["auth-finish"]]);
}
{
  const adapter = new MemoryAdapter([queuedJob("lease-race")], { loseLeaseDuringAuth: new Set(["lease-race"]) });
  const result = await runDeletionProcessor({ adapter, ownerId: "old-worker", logger: captureLogger().logger });
  assert.equal(result.failed, 1);
  assert.equal(adapter.jobs.get("lease-race").leaseToken, "new-owner");
  assert.equal(adapter.jobs.get("lease-race").phase, "auth-deleting");
  assert.equal(adapter.writes.some(([code]) => code === "auth-finish"), false);
}
{
  const adapter = new MemoryAdapter([queuedJob("missing")]); adapter.auth.clear();
  assert.equal((await runDeletionProcessor({ adapter, ownerId: "worker", logger: captureLogger().logger })).processed, 1);
}
{
  const adapter = new MemoryAdapter([queuedJob("bad"), queuedJob("good")], { untrusted: new Set(["bad"]), heartbeatFails: true });
  const { entries, logger } = captureLogger(); const result = await runDeletionProcessor({ adapter, ownerId: "worker", logger });
  assert.equal(result.failed, 1); assert.equal(result.processed, 1);
  assert.equal(entries.join(" ").includes("bad"), false); assert.equal(entries.join(" ").includes("good"), false);
  assert.ok(entries.every((entry) => /^[A-Z0-9_]+$/.test(entry)));
}
{
  const adapter = new MemoryAdapter([queuedJob("race")], { recreateProfileBeforeFinalize: new Set(["race"]) });
  const result = await runDeletionProcessor({ adapter, ownerId: "worker", logger: captureLogger().logger });
  assert.equal(result.failed, 1); assert.equal(adapter.jobs.get("race").errorCode, "PROFILE_RECREATED");
}
{
  const adapter = new MemoryAdapter([queuedJob("expired")]);
  adapter.jobs.set("expired", { status: "completed", completedAt: -8_000_000, purgeAfter: -800_000 });
  adapter.jobs.set("malformed", { status: "completed", completedAt: -8_000_000, purgeAfter: -800_000, uid: "secret" });
  const result = await runDeletionProcessor({ adapter, ownerId: "worker", logger: captureLogger().logger });
  assert.equal(result.purged, 1); assert.equal(adapter.jobs.has("expired"), false); assert.equal(adapter.jobs.has("malformed"), true);
}
{
  const active = Array.from({ length: 205 }, (_, index) => queuedJob(`a-active-${String(index).padStart(3, "0")}`, { status: "processing", leaseExpiresAt: 20_000 }));
  const malformed = Array.from({ length: 205 }, (_, index) => ({
    id: `a-malformed-${String(index).padStart(3, "0")}`,
    data: { status: "completed", completedAt: -8_000_000, purgeAfter: -800_000, extra: true }
  }));
  const exactMarker = { id: "z-expired", data: { status: "completed", completedAt: -8_000_000, purgeAfter: -800_000 } };
  const adapter = new PagedMemoryAdapter([...active, queuedJob("z-queued")], [...malformed, exactMarker]);
  const result = await runDeletionProcessor({ adapter, ownerId: "worker", logger: captureLogger().logger });
  assert.equal(result.skipped, 205);
  assert.equal(result.processed, 1, "queued work after more than 200 active jobs is not starved");
  assert.equal(result.purged, 1, "expired marker after more than 200 malformed markers is not starved");
  assert.equal(adapter.markerDocs.has("z-expired"), false);
  assert.equal(adapter.markerDocs.size, 205);
}
console.log("Administrator deletion processor behavior passed");
