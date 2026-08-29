import { redactedSummary } from "../moderation-processor-policy.mjs";
import { assertSettledModerationResult } from "../production-rollout-policy.mjs";
import { main as processModeration } from "./moderation-processor.mjs";
import { main as migratePollVotes } from "./poll-vote-migration.mjs";

Promise.resolve().then(() => migratePollVotes()).then(() => processModeration()).then((result) => {
  assertSettledModerationResult(result);
  console.log(redactedSummary(result));
}).catch(() => {
  console.error("MODERATION_ROLLOUT_FAILED");
  process.exitCode = 1;
});
