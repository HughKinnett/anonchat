import { pathToFileURL } from "node:url";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { FirestoreBadgeAwardAdapter } from "../badge-award-firestore-adapter.mjs";
import { reconcileActivityBadges } from "../badge-activity-reconciliation.mjs";
import { loadBadgeReconciliationCursor, saveBadgeReconciliationCursor } from "../badge-reconciliation-state.mjs";

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
  const app = initializeApp({ credential: applicationDefault(), projectId }, `badge-activity-${Date.now()}`);
  try {
    const db = getFirestore(app);
    const adapter = new FirestoreBadgeAwardAdapter({ db, FieldValue });
    const startCursor = await loadBadgeReconciliationCursor({ db, kind: "activity" });
    const result = await reconcileActivityBadges({ adapter, startCursor });
    await saveBadgeReconciliationCursor({ db, kind: "activity", cursor: result.nextCursor });
    return result;
  } finally {
    await deleteApp(app);
  }
};

const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main()
  .then((result) => console.log(`BADGE_ACTIVITY_RESULT inspected=${result.inspected} evaluated=${result.evaluated} batches=${result.batches} nextCursor=${result.nextCursor ?? "none"}`))
  .catch((error) => { console.error("BADGE_ACTIVITY_FATAL", error?.message || error); process.exitCode = 1; });
