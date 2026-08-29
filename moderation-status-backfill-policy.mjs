export const MAX_BACKFILL_BATCH_SIZE = 400;
const TARGET_COLLECTIONS = ["posts", "rooms", "communityPosts"];

export const planModerationStatusUpdate = (data) => (
  data != null
    && typeof data === "object"
    && !Object.prototype.hasOwnProperty.call(data, "moderationStatus")
    ? { moderationStatus: "active" }
    : null
);

export const runModerationStatusBackfill = async ({
  adapter,
  apply = false,
  batchSize = MAX_BACKFILL_BATCH_SIZE
}) => {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BACKFILL_BATCH_SIZE) {
    throw new Error("INVALID_BATCH_SIZE");
  }

  const result = {
    mode: apply ? "apply" : "dry-run",
    scanned: 0,
    eligible: 0,
    updated: 0,
    batches: 0
  };

  for (const collectionName of TARGET_COLLECTIONS) {
    let afterId = null;
    while (true) {
      const page = await adapter.scan(collectionName, afterId, batchSize);
      if (!Array.isArray(page.documents) || page.documents.length > batchSize) {
        throw new Error("INVALID_SCAN_PAGE");
      }

      result.scanned += page.documents.length;
      const updates = page.documents.flatMap((document) => {
        const patch = planModerationStatusUpdate(document.data);
        return patch == null ? [] : [{ collectionName, document, patch }];
      });
      result.eligible += updates.length;

      if (apply && updates.length > 0) {
        await adapter.commit(updates);
        result.updated += updates.length;
        result.batches += 1;
      }

      if (page.nextCursor == null) break;
      if (page.nextCursor === afterId) throw new Error("INVALID_SCAN_CURSOR");
      afterId = page.nextCursor;
    }
  }

  return result;
};
