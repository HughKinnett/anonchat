import { redactedSummary } from "../moderation-processor-policy.mjs";
import { assertSettledModerationResult } from "../production-rollout-policy.mjs";
import { main as processModeration } from "./moderation-processor.mjs";

processModeration().then((result) => {
  assertSettledModerationResult(result);
  console.log(redactedSummary(result));
}).catch(() => {
  console.error("MODERATION_ROLLOUT_FAILED");
  process.exitCode = 1;
});
