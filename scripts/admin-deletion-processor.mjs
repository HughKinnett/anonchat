import { pathToFileURL } from "node:url";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreDeletionAdapter } from "../admin-deletion-firestore-adapter.mjs";
import { runDeletionProcessor } from "../admin-deletion-processor.mjs";

export const parseArguments = (argumentsList) => {
  const supported = new Set(["--dry-run"]);
  if (argumentsList.some((argument) => !supported.has(argument))) throw new Error("INVALID_ARGUMENT");
  return { dryRun: argumentsList.includes("--dry-run") };
};
export const main = async (argumentsList = process.argv.slice(2)) => {
  const options = parseArguments(argumentsList);
  const app = initializeApp({ credential: applicationDefault(), projectId: "anonchatlogin" });
  const adapter = new FirestoreDeletionAdapter({ db: getFirestore(app), auth: getAuth(app), Timestamp, FieldPath });
  return runDeletionProcessor({ adapter, ownerId: `processor-${crypto.randomUUID()}`, dryRun: options.dryRun, logger: console });
};
const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main().catch(() => { console.error("PROCESSOR_FATAL"); process.exitCode = 1; });
