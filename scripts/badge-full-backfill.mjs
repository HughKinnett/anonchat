import { pathToFileURL } from "node:url";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { FirestoreBadgeAwardAdapter } from "../badge-award-firestore-adapter.mjs";
import { reconcileAllExistingUsers } from "../badge-full-reconciliation.mjs";

const resolveProjectId = (environment = process.env) => {
  const direct = environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  try {
    const configured = JSON.parse(environment.FIREBASE_CONFIG ?? "{}").projectId;
    if (typeof configured === "string" && configured.trim()) return configured.trim();
  } catch {}
  return "anonchatlogin";
};

export const main = async (dependencies = {}) => {
  const projectId = resolveProjectId(dependencies.env ?? process.env);
  const app = initializeApp({ credential: applicationDefault(), projectId }, `badge-full-backfill-${Date.now()}`);
  try {
    const db = getFirestore(app);
    const adapter = new FirestoreBadgeAwardAdapter({ db, FieldValue });
    return await reconcileAllExistingUsers({ adapter });
  } finally {
    await deleteApp(app);
  }
};

const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main()
  .then((result) => console.log(
    `BADGE_FULL_BACKFILL_RESULT completed=${result.completed} identityUsers=${result.identityUsers} activityUsers=${result.activityUsers} identityPasses=${result.identityPasses} activityPasses=${result.activityPasses}`
  ))
  .catch((error) => {
    console.error("BADGE_FULL_BACKFILL_FATAL", error?.message || error);
    process.exitCode = 1;
  });
