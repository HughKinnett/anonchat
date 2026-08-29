import { fixedErrorCode } from "./moderation-deletion-policy.mjs";

const PHASE_ORDER = new Map([
  ["claimed", 0],
  ["reposts-locked", 1],
  ["dependencies-cleaned", 2],
  ["reports-resolved", 3],
  ["reports-removed", 4]
]);
const beforePhase = (phase, next) => (PHASE_ORDER.get(phase) ?? 0) < PHASE_ORDER.get(next);
const safeLog = (logger, level, code) => {
  const method = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  if (typeof method === "function") method.call(logger, code);
};
const safeHeartbeat = async (adapter, logger, status, errorCode) => {
  try { await adapter.heartbeat(status, errorCode); } catch { safeLog(logger, "error", "HEARTBEAT_ERROR"); }
};

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

export const runModerationDeletionProcessor = async ({ adapter, ownerId, dryRun = false, logger = console }) => {
  const result = { inspected: 0, processed: 0, failed: 0, skipped: 0, cleaned: 0 };
  await safeHeartbeat(adapter, logger, "started");
  for await (const jobs of scanPages(cursor => adapter.scanJobsPage(cursor))) {
    for (const job of jobs) {
      result.inspected += 1;
      if (dryRun) {
        try { if (!(await adapter.preview(job))) result.skipped += 1; } catch (error) { result.failed += 1; safeLog(logger, "error", fixedErrorCode(error)); }
        continue;
      }
      let claim;
      try {
        claim = await adapter.claim(job.id, ownerId);
        if (!claim) { result.skipped += 1; continue; }
        let phase = claim.phase;
        if (beforePhase(phase, "reposts-locked")) {
          await adapter.lockReposts(claim.id, claim.token);
          phase = "reposts-locked";
        }
        if (beforePhase(phase, "dependencies-cleaned")) {
          await adapter.cleanDependencies(claim.id, claim.token);
          phase = "dependencies-cleaned";
        }
        if (beforePhase(phase, "reports-resolved")) {
          await adapter.resolveReports(claim.id, claim.token);
          phase = "reports-resolved";
        }
        if (beforePhase(phase, "reports-removed")) {
          await adapter.removeReports(claim.id, claim.token);
          phase = "reports-removed";
        }
        await adapter.finalize(claim.id, claim.token, adapter.timestamp(adapter.now()));
        result.processed += 1;
        safeLog(logger, "info", "JOB_COMPLETED");
      } catch (error) {
        const code = fixedErrorCode(error);
        result.failed += 1;
        if (claim?.token) {
          try { await adapter.fail(claim.id, claim.token, code); } catch { safeLog(logger, "error", "FAIL_STATE_ERROR"); }
        }
        safeLog(logger, "error", code);
      }
    }
  }
  if (!dryRun) {
    try { result.cleaned = await adapter.cleanupResolvedReports(); }
    catch { result.failed += 1; safeLog(logger, "error", "REPORT_CLEANUP_ERROR"); }
  }
  await safeHeartbeat(adapter, logger, result.failed ? "error" : "completed", result.failed ? "JOB_FAILURE" : undefined);
  return result;
};
