import { voteDocumentPlan } from "./vote-schema-policy.mjs";

export const MAX_VOTE_MIGRATIONS_PER_BATCH = 200;

export const planLegacyVoteMigration = (document, presence) => {
  const data = document?.data;
  if (!data || data.postCollection !== undefined) return null;
  const matches = ["posts", "communityPosts"].filter(collectionName => presence?.[collectionName] === true);
  if (matches.length !== 1) return null;
  const postCollection = matches[0];
  const plan = voteDocumentPlan({ ...data, postCollection });
  return { fromId: document.id, toId: plan.id, data: plan.data };
};

export const runVoteSchemaBackfill = async ({
  adapter,
  apply = false,
  batchSize = MAX_VOTE_MIGRATIONS_PER_BATCH
}) => {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_VOTE_MIGRATIONS_PER_BATCH) {
    throw new Error("INVALID_BATCH_SIZE");
  }
  const result = {
    mode: apply ? "apply" : "dry-run",
    scanned: 0,
    eligible: 0,
    migrated: 0,
    ambiguous: 0,
    alreadyMigrated: 0,
    batches: 0
  };
  let afterId = null;
  while (true) {
    const page = await adapter.scan(afterId, batchSize);
    if (!Array.isArray(page.documents) || page.documents.length > batchSize) throw new Error("INVALID_SCAN_PAGE");
    const migrations = [];
    for (const document of page.documents) {
      result.scanned += 1;
      if (document.data?.postCollection !== undefined) {
        result.alreadyMigrated += 1;
        continue;
      }
      const migration = planLegacyVoteMigration(document, await adapter.targetPresence(document.data?.postId));
      if (!migration) result.ambiguous += 1;
      else migrations.push(migration);
    }
    result.eligible += migrations.length;
    if (apply && migrations.length) {
      await adapter.commit(migrations);
      result.migrated += migrations.length;
      result.batches += 1;
    }
    if (page.nextCursor == null) break;
    if (page.nextCursor === afterId) throw new Error("INVALID_SCAN_CURSOR");
    afterId = page.nextCursor;
  }
  return result;
};
