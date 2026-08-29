import { fixedErrorCode } from "./moderation-processor-policy.mjs";

const log = (logger, level, code) => {
  const method = logger?.[level] ?? logger?.log;
  if (typeof method === "function") method.call(logger, code);
};
async function* pages(fetchPage) {
  let cursor;
  while (true) {
    const page = await fetchPage(cursor);
    if (!page?.items?.length) return;
    yield page.items;
    if (!page.nextCursor || page.nextCursor === cursor) throw Object.assign(new Error("action-limit"), { code: "action-limit" });
    cursor = page.nextCursor;
  }
}
const heartbeat = async (adapter, logger, state, errorCode) => {
  try { await adapter.heartbeat(state, errorCode); } catch { log(logger, "error", "HEARTBEAT_ERROR"); throw Object.assign(new Error("heartbeat-failed"), { code: "heartbeat-failed" }); }
};
export const processModeration = async (adapter, { ownerId = `moderation-${crypto.randomUUID()}`, logger = console, dryRun = false } = {}) => {
  const runCutoff = adapter.now();
  const summary = { inspected: 0, processed: 0, failed: 0, skipped: 0, terminalIntakes: 0, terminalActions: 0, expiredRooms: 0, backfilled: 0, roomLifecycleMigrated: 0, roomLifecycleQuarantined: 0, roomLifecycleDeferred: 0, legacyRoomsCleaned: 0, legacyRoomsManualReview: 0 };
  await heartbeat(adapter, logger, "started");
  try {
    if (dryRun) { await heartbeat(adapter, logger, "completed"); return summary; }
    const backfill = await adapter.backfillModerationState();
    summary.backfilled = backfill?.migrated ?? 0;
    log(logger, "log", `MODERATION_BACKFILL backfilled=${summary.backfilled}`);
    let moderationSettled = true;
    for await (const entries of pages((cursor) => adapter.scanIntakesPage(cursor, runCutoff))) for (const entry of entries) {
      summary.inspected += 1;
      let claim;
      try {
        claim = await adapter.claimIntake(entry.id, ownerId);
        if (!claim && await adapter.settleTerminalIntake?.(entry.id)) { summary.terminalIntakes += 1; continue; }
        if (!claim) { summary.skipped += 1; moderationSettled = false; continue; }
        await adapter.processClaimedIntake(claim.id, claim.token); summary.processed += 1;
      } catch (error) { if (claim) await adapter.failIntake?.(claim.id, claim.token, fixedErrorCode(error)).catch(() => {}); summary.failed += 1; moderationSettled = false; log(logger, "error", fixedErrorCode(error)); }
    }
    for await (const entries of pages((cursor) => adapter.scanActionsPage(cursor))) for (const entry of entries) {
      summary.inspected += 1;
      let claim;
      try {
        claim = await adapter.claimAction(entry.id, ownerId);
        if (!claim && await adapter.settleTerminalAction?.(entry.id)) { summary.terminalActions += 1; continue; }
        if (!claim) { summary.skipped += 1; moderationSettled = false; continue; }
        await adapter.executeClaimedAction(claim.id, claim.token); summary.processed += 1;
      } catch (error) { if (claim) await adapter.failAction?.(claim.id, claim.token, fixedErrorCode(error)).catch(() => {}); summary.failed += 1; moderationSettled = false; log(logger, "error", fixedErrorCode(error)); }
    }
    log(logger, "log", `TERMINAL_INTAKES count=${summary.terminalIntakes}`);
    log(logger, "log", `TERMINAL_ACTIONS count=${summary.terminalActions}`);
    if (adapter.scanStaleClosingRoomsPage && adapter.recoverStaleClosingRoom) {
      for await (const entries of pages((cursor) => adapter.scanStaleClosingRoomsPage(cursor))) for (const entry of entries) {
        try { await adapter.recoverStaleClosingRoom(entry.id); } catch (error) { summary.failed += 1; log(logger, "error", fixedErrorCode(error)); }
      }
    }
    if (!moderationSettled) {
      summary.roomLifecycleDeferred = 1;
      log(logger, "log", "ROOM_LIFECYCLE_DEFERRED count=1");
    } else {
      const roomLifecycle = await adapter.backfillRoomLifecycle?.();
      summary.roomLifecycleMigrated = roomLifecycle?.migrated ?? 0;
      summary.roomLifecycleQuarantined = roomLifecycle?.quarantined ?? 0;
      log(logger, "log", `ROOM_LIFECYCLE_BACKFILL migrated=${summary.roomLifecycleMigrated}`);
      log(logger, "log", `ROOM_LIFECYCLE_QUARANTINED count=${summary.roomLifecycleQuarantined}`);
      for await (const entries of pages((cursor) => adapter.scanLegacyRoomActionsPage?.(cursor) ?? Promise.resolve({ items: [] }))) for (const entry of entries) {
        try { await adapter.processLegacyRoomAction(entry.id); } catch (error) { summary.failed += 1; log(logger, "error", fixedErrorCode(error)); }
      }
      for await (const entries of pages((cursor) => adapter.scanLegacyRoomQueuePage(cursor))) for (const entry of entries) {
        let claim;
        try {
          claim = await adapter.claimLegacyRoom(entry.id, ownerId, runCutoff);
          if (!claim) {
            if (await adapter.settleTerminalLegacyRoom?.(entry.id)) summary.legacyRoomsManualReview += 1;
            continue;
          }
          if (await adapter.executeClaimedLegacyRoom(claim.id, claim.token, { ownerId, runCutoff })) summary.legacyRoomsCleaned += 1;
        } catch (error) {
          if (claim && await adapter.failLegacyRoom?.(claim.id, claim.token, fixedErrorCode(error)).catch(() => false)) summary.legacyRoomsManualReview += 1;
          summary.failed += 1; log(logger, "error", fixedErrorCode(error));
        }
      }
      for await (const entries of pages((cursor) => adapter.scanExpiredRoomsPage(cursor, runCutoff))) for (const entry of entries) {
        try { if (await adapter.cleanupExpiredRoom(entry.id, { ownerId, runCutoff })) summary.expiredRooms += 1; } catch (error) { summary.failed += 1; log(logger, "error", fixedErrorCode(error)); }
      }
    }
    await heartbeat(adapter, logger, "completed");
    return summary;
  } catch (error) {
    const errorCode = fixedErrorCode(error);
    log(logger, "error", errorCode);
    await heartbeat(adapter, logger, "failed", errorCode);
    throw error;
  }
};
