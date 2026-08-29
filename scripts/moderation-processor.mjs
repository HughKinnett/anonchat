import { pathToFileURL } from "node:url";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreModerationAdapter } from "../moderation-firestore-adapter.mjs";
import { redactedSummary } from "../moderation-processor-policy.mjs";
import { processModeration } from "../moderation-processor.mjs";

export const parseArguments = (argumentsList) => {
  if (argumentsList.some((argument) => argument !== "--dry-run")) throw new Error("INVALID_ARGUMENT");
  return { dryRun: argumentsList.includes("--dry-run") };
};
export const resolveProjectId = (environment = process.env) => {
  const direct = environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  try { const project = JSON.parse(environment.FIREBASE_CONFIG ?? "{}").projectId; if (typeof project === "string" && project.trim()) return project.trim(); } catch {}
  return "anonchatlogin";
};
const createRuntime = async (projectId) => {
  const app = initializeApp({ credential: applicationDefault(), projectId });
  return { adapter: new FirestoreModerationAdapter({ db: getFirestore(app), Timestamp, FieldPath }), close: () => deleteApp(app) };
};
export const main = async (argumentsList = process.argv.slice(2), dependencies = {}) => {
  const options = parseArguments(argumentsList); const runtime = await (dependencies.createRuntime ?? createRuntime)(resolveProjectId(dependencies.env ?? process.env));
  try { return await (dependencies.processor ?? processModeration)(runtime.adapter, { ownerId: (dependencies.ownerIdFactory ?? (() => `moderation-${crypto.randomUUID()}`))(), dryRun: options.dryRun, logger: dependencies.logger ?? console }); }
  finally { await runtime.close?.(); }
};
const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main().then((result) => console.log(redactedSummary(result))).catch(() => { console.error("PROCESSOR_FATAL"); process.exitCode = 1; });
