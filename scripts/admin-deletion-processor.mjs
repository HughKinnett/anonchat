import { pathToFileURL } from "node:url";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreDeletionAdapter } from "../admin-deletion-firestore-adapter.mjs";
import { runDeletionProcessor } from "../admin-deletion-processor.mjs";

export const parseArguments = (argumentsList) => {
  const supported = new Set(["--dry-run"]);
  if (argumentsList.some((argument) => !supported.has(argument))) throw new Error("INVALID_ARGUMENT");
  return { dryRun: argumentsList.includes("--dry-run") };
};
export const resolveProjectId = (environment = process.env) => {
  const direct = environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  try {
    const configured = JSON.parse(environment.FIREBASE_CONFIG ?? "{}").projectId;
    if (typeof configured === "string" && configured.trim()) return configured.trim();
  } catch {}
  return "anonchatlogin";
};
export const fixedResultSummary = (result) => `PROCESSOR_RESULT inspected=${result.inspected} processed=${result.processed} failed=${result.failed} skipped=${result.skipped} purged=${result.purged}`;
const createProductionRuntime = async (projectId) => {
  const app = initializeApp({ credential: applicationDefault(), projectId });
  return {
    adapter: new FirestoreDeletionAdapter({ db: getFirestore(app), auth: getAuth(app), Timestamp, FieldPath }),
    close: () => deleteApp(app)
  };
};
export const main = async (argumentsList = process.argv.slice(2), dependencies = {}) => {
  const options = parseArguments(argumentsList);
  const projectId = resolveProjectId(dependencies.env ?? process.env);
  const runtime = await (dependencies.createRuntime ?? createProductionRuntime)(projectId);
  try {
    return await (dependencies.processor ?? runDeletionProcessor)({
      adapter: runtime.adapter,
      ownerId: (dependencies.ownerIdFactory ?? (() => `processor-${crypto.randomUUID()}`))(),
      dryRun: options.dryRun,
      logger: dependencies.logger ?? console
    });
  } finally {
    await runtime.close?.();
  }
};
const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main()
  .then((result) => { console.log(fixedResultSummary(result)); })
  .catch(() => { console.error("PROCESSOR_FATAL"); process.exitCode = 1; });
