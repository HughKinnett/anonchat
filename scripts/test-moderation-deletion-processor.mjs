import assert from "node:assert/strict";
import { runModerationDeletionProcessor } from "../moderation-deletion-processor.mjs";

const queuedJob = (targetType, targetId) => ({
  id: `${targetType}_${targetId}`,
  data: { targetType, targetId, reportId: `anchor-${targetId}`, requesterUid: "admin", requestedAt: 1_000, status: "queued" }
});

class MemoryAdapter {
  constructor(jobs, options = {}) {
    this.jobs = new Map(jobs.map(job => [job.id, structuredClone(job.data)]));
    this.options = options;
    this.targets = new Set(jobs.map(job => `${job.data.targetType}/${job.data.targetId}`));
    this.dependencies = new Map(jobs.map(job => [job.id, new Set(Array.from({ length: 805 }, (_, index) => `dependency-${String(index).padStart(4, "0")}`))]));
    this.reports = new Map(jobs.map(job => [job.id, new Map([
      [`anchor-${job.data.targetId}`, "pending"],
      [`legacy-a-${job.data.targetId}`, "pending"],
      [`legacy-z-${job.data.targetId}`, "pending"]
    ])]));
    this.actions = new Map();
    this.clock = 10_000;
    this.lockCalls = 0;
    this.cleanupCalls = 0;
    this.reportRemovalCalls = 0;
  }
  now() { return this.clock; }
  timestamp(value) { return value; }
  async heartbeat() {}
  async scanJobsPage(cursor) {
    const values = [...this.jobs].filter(([, data]) => ["queued", "failed", "processing"].includes(data.status)).sort(([a], [b]) => a.localeCompare(b));
    const selected = values.filter(([id]) => !cursor || id > cursor).slice(0, 200);
    return { items: selected.map(([id, data]) => ({ id, data: structuredClone(data) })), nextCursor: selected.at(-1)?.[0] };
  }
  async preview() { return true; }
  async claim(id, owner) {
    const job = this.jobs.get(id);
    if (!job || !["queued", "failed"].includes(job.status)) return null;
    const token = `${owner}-${(job.attempts || 0) + 1}`;
    Object.assign(job, { status: "processing", phase: job.phase || "claimed", attempts: (job.attempts || 0) + 1, leaseToken: token, leaseExpiresAt: this.clock + 100 });
    return { id, token, phase: job.phase };
  }
  assertLease(id, token) {
    if (this.jobs.get(id)?.leaseToken !== token) throw Object.assign(new Error("lost"), { code: "lease-lost" });
  }
  async cleanDependencies(id, token) {
    this.assertLease(id, token);
    assert.equal(this.jobs.get(id).phase, "reposts-locked",
      "dependency cleanup cannot start before the durable repost lock phase");
    this.cleanupCalls += 1;
    const dependencies = this.dependencies.get(id);
    while (dependencies.size) [...dependencies].sort().slice(0, 200).forEach(value => dependencies.delete(value));
    this.jobs.get(id).phase = "dependencies-cleaned";
  }
  async lockReposts(id, token) {
    this.assertLease(id, token);
    this.lockCalls += 1;
    this.jobs.get(id).phase = "reposts-locked";
  }
  async resolveReports(id, token) {
    this.assertLease(id, token);
    for (const reportId of this.reports.get(id).keys()) this.reports.get(id).set(reportId, "resolved");
    this.jobs.get(id).phase = "reports-resolved";
  }
  async removeReports(id, token) {
    this.assertLease(id, token);
    this.reportRemovalCalls += 1;
    if (this.options.failReportRemovalOnce) {
      this.options.failReportRemovalOnce = false;
      const first = [...this.reports.get(id).keys()].sort()[0];
      this.reports.get(id).delete(first);
      throw Object.assign(new Error("transient"), { code: "unavailable" });
    }
    this.reports.get(id).clear();
    this.jobs.get(id).phase = "reports-removed";
  }
  async finalize(id, token, completedAt) {
    this.assertLease(id, token);
    const job = this.jobs.get(id);
    assert.equal(this.dependencies.get(id).size, 0);
    assert.equal(this.reports.get(id).size, 0);
    this.targets.delete(`${job.targetType}/${job.targetId}`);
    this.actions.set(id, { action: job.targetType === "room" ? "delete-room" : "delete-post", reportCount: 3 });
    this.jobs.set(id, {
      targetType: job.targetType, targetId: job.targetId,
      requesterUid: job.requesterUid, requestedAt: job.requestedAt, status: "completed",
      completedAt, actionId: id, reportCount: 3
    });
  }
  async fail(id, token, code) {
    const job = this.jobs.get(id);
    if (job?.leaseToken === token) Object.assign(job, { status: "failed", errorCode: code });
  }
  async cleanupResolvedReports() { return 0; }
}

const quiet = { info() {}, error() {} };

{
  const adapter = new MemoryAdapter([queuedJob("room", "large")]);
  const result = await runModerationDeletionProcessor({ adapter, ownerId: "worker", logger: quiet });
  assert.deepEqual(result, { inspected: 1, processed: 1, failed: 0, skipped: 0, cleaned: 0 });
  assert.equal(adapter.dependencies.get("room_large").size, 0, "more than 397 dependents are paged without a cap");
  assert.equal(adapter.lockCalls, 1, "every job durably advances through the repost lock phase");
  assert.equal(adapter.reports.get("room_large").size, 0, "all target reports, including legacy duplicates, are removed");
  assert.equal(adapter.targets.has("room/large"), false);
  assert.equal(adapter.actions.get("room_large").reportCount, 3);
  assert.equal(adapter.jobs.get("room_large").status, "completed");
  assert.equal((await runModerationDeletionProcessor({ adapter, ownerId: "retry", logger: quiet })).processed, 0,
    "completed jobs are idempotent");
}

{
  const adapter = new MemoryAdapter([queuedJob("post", "partial")], { failReportRemovalOnce: true });
  const first = await runModerationDeletionProcessor({ adapter, ownerId: "worker-a", logger: quiet });
  assert.equal(first.failed, 1);
  assert.equal(adapter.targets.has("post/partial"), true, "target stays reported and locked until finalization");
  assert.equal(adapter.dependencies.get("post_partial").size, 0, "completed cleanup remains durable across retry");
  assert.ok(adapter.reports.get("post_partial").size > 0, "partial report cleanup remains visible to the durable job");
  const second = await runModerationDeletionProcessor({ adapter, ownerId: "worker-b", logger: quiet });
  assert.equal(second.processed, 1);
  assert.equal(adapter.targets.has("post/partial"), false);
  assert.equal(adapter.reports.get("post_partial").size, 0);
  assert.equal(adapter.cleanupCalls, 1, "retry resumes at the durable phase instead of repeating completed work");
  assert.equal(adapter.lockCalls, 1, "retry does not repeat the durable repost lock phase");
}

{
  const adapter = new MemoryAdapter([queuedJob("communityPost", "dry")]);
  const result = await runModerationDeletionProcessor({ adapter, ownerId: "worker", dryRun: true, logger: quiet });
  assert.deepEqual(result, { inspected: 1, processed: 0, failed: 0, skipped: 0, cleaned: 0 });
  assert.equal(adapter.cleanupCalls, 0);
}

{
  const active = Array.from({ length: 205 }, (_, index) => {
    const entry = queuedJob("post", `active-${String(index).padStart(3, "0")}`);
    Object.assign(entry.data, { status: "processing", phase: "claimed", leaseExpiresAt: 20_000 });
    return entry;
  });
  const adapter = new MemoryAdapter([...active, queuedJob("room", "z-queued")]);
  const result = await runModerationDeletionProcessor({ adapter, ownerId: "worker", logger: quiet });
  assert.equal(result.skipped, 205);
  assert.equal(result.processed, 1, "queued work behind a full page of active leases is not starved");
}

console.log("Moderation deletion processor behavior passed");
