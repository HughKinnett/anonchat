import { COMPLETION_RETENTION_MS, fixedErrorCode, isExactCompletionMarker, timestampToMillis } from "./admin-deletion-processor-policy.mjs";

const safeLog = (logger, level, code) => {
  const method = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  if (typeof method === "function") method.call(logger, code);
};
const safeHeartbeat = async (adapter, logger, state, code) => {
  try { await adapter.heartbeat(state, code); } catch { safeLog(logger, "error", "HEARTBEAT_ERROR"); }
};
const PHASE_ORDER = new Map([["claimed", 0], ["first-sweep", 1], ["profile-barrier", 2], ["second-sweep", 3], ["auth-deleting", 4], ["auth-deleted", 5]]);
const beforePhase = (current, next) => (PHASE_ORDER.get(current) ?? 0) < PHASE_ORDER.get(next);

export async function* scanPages(fetchPage) {
  let cursor;
  while (true) {
    const page = await fetchPage(cursor);
    if (!page.items.length) return;
    yield page.items;
    if (!page.nextCursor || page.nextCursor === cursor) throw Object.assign(new Error("scan limit"), { code: "cleanup-limit" });
    cursor = page.nextCursor;
  }
}

export const runDeletionProcessor = async ({ adapter, ownerId, dryRun = false, logger = console }) => {
  const result = { inspected: 0, processed: 0, failed: 0, skipped: 0, purged: 0 };
  if (dryRun) {
    for await (const jobs of scanPages((cursor) => adapter.scanJobsPage(cursor))) {
      result.inspected += jobs.length;
      for (const job of jobs) await adapter.preview(job);
    }
    return result;
  }
  await safeHeartbeat(adapter, logger, "started");
  try {
    for await (const markers of scanPages((cursor) => adapter.scanMarkersPage(cursor))) {
      for (const marker of markers) {
        try {
          if (!isExactCompletionMarker(marker.data) || timestampToMillis(marker.data.purgeAfter) > adapter.now()) {
            throw Object.assign(new Error("malformed marker"), { code: "malformed-marker" });
          }
          await adapter.purgeMarker(marker.id, marker.data); result.purged += 1; safeLog(logger, "info", "MARKER_PURGED");
        } catch (error) { safeLog(logger, "error", fixedErrorCode(error)); }
      }
    }
  } catch { safeLog(logger, "error", "MARKER_SCAN_ERROR"); }
  for await (const jobs of scanPages((cursor) => adapter.scanJobsPage(cursor))) {
    result.inspected += jobs.length;
    for (const job of jobs) {
      let claim;
      try {
        claim = await adapter.claim(job.id, ownerId);
        if (!claim) { result.skipped += 1; continue; }
        let phase = claim.phase;
        if (beforePhase(phase, "first-sweep")) { await adapter.firstSweep(claim.targetUid, claim.token); phase = "first-sweep"; }
        if (beforePhase(phase, "profile-barrier")) { await adapter.removeProfileBarrier(claim.targetUid, claim.token); phase = "profile-barrier"; }
        if (beforePhase(phase, "second-sweep")) { await adapter.secondSweep(claim.targetUid, claim.token); phase = "second-sweep"; }
        if (beforePhase(phase, "auth-deleted")) {
          await adapter.beginAuthDeletion(claim.targetUid, claim.token);
          phase = "auth-deleting";
          await adapter.deleteAuth(claim.targetUid, claim.token);
          await adapter.finishAuthDeletion(claim.targetUid, claim.token);
          phase = "auth-deleted";
        }
        const completed = adapter.now();
        await adapter.finalize(claim.targetUid, claim.token, adapter.timestamp(completed), adapter.timestamp(completed + COMPLETION_RETENTION_MS));
        result.processed += 1; safeLog(logger, "info", "JOB_COMPLETED");
      } catch (error) {
        const code = fixedErrorCode(error); result.failed += 1;
        if (claim?.token) try { await adapter.fail(claim.targetUid, claim.token, code); } catch { safeLog(logger, "error", "FAIL_STATE_ERROR"); }
        safeLog(logger, "error", code);
      }
    }
  }
  await safeHeartbeat(adapter, logger, result.failed ? "error" : "completed", result.failed ? "JOB_FAILURE" : undefined);
  return result;
};
