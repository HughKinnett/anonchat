import { pathToFileURL } from "node:url";
import { main as runModerationStatus } from "./backfill-moderation-status.mjs";
import { main as runVoteSchema } from "./backfill-vote-schema.mjs";

const migrateAndVerify = async (runner, incompleteCode) => {
  const dryRun = await runner([]);
  const apply = await runner(["--apply"]);
  const verify = await runner([]);
  if (verify?.eligible !== 0) throw new Error(incompleteCode);
  return { dryRun, apply, verify };
};

export const runProductionMigrations = async ({
  moderationStatus = runModerationStatus,
  voteSchema = runVoteSchema
} = {}) => {
  const moderationStatusResult = await migrateAndVerify(
    moderationStatus,
    "MODERATION_STATUS_MIGRATION_INCOMPLETE"
  );
  const voteSchemaResult = await migrateAndVerify(
    voteSchema,
    "VOTE_SCHEMA_MIGRATION_INCOMPLETE"
  );
  return { moderationStatus: moderationStatusResult, voteSchema: voteSchemaResult };
};

const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) runProductionMigrations()
  .then((result) => {
    console.log(JSON.stringify({
      status: "complete",
      moderationStatus: result.moderationStatus,
      voteSchema: result.voteSchema
    }));
  })
  .catch(() => {
    console.error("PRODUCTION_MIGRATIONS_FATAL");
    process.exitCode = 1;
  });
