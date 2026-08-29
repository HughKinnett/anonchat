import { pathToFileURL } from "node:url";
import { main as runAccountDeletion } from "./admin-deletion-processor.mjs";
import { main as runModerationDeletion } from "./moderation-deletion-processor.mjs";

const runOne = async operation => {
  try { return { ok: true, result: await operation() }; }
  catch { return { ok: false, errorCode: "PROCESSOR_FATAL" }; }
};

export const main = async (argumentsList = process.argv.slice(2), dependencies = {}) => {
  const account = await runOne(() => (dependencies.runAccount ?? runAccountDeletion)(argumentsList));
  const moderation = await runOne(() => (dependencies.runModeration ?? runModerationDeletion)(argumentsList));
  return { ok: account.ok && moderation.ok, account, moderation };
};

const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main().then(result => {
  console.log(`DELETION_PROCESSORS_RESULT account=${result.account.ok ? "ok" : "failed"} moderation=${result.moderation.ok ? "ok" : "failed"}`);
  if (!result.ok) process.exitCode = 1;
});
