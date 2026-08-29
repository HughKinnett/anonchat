import { pathToFileURL } from "node:url";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { runModerationStatusBackfill } from "../moderation-status-backfill-policy.mjs";

export const parseArguments = (argumentsList) => {
  const supported = new Set(["--apply"]);
  if (argumentsList.some((argument) => !supported.has(argument))) {
    throw new Error("INVALID_ARGUMENT");
  }
  return { apply: argumentsList.includes("--apply") };
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

export const fixedResultSummary = (result) => (
  `BACKFILL_RESULT mode=${result.mode} scanned=${result.scanned} eligible=${result.eligible} updated=${result.updated} batches=${result.batches}`
);

class FirestoreModerationStatusAdapter {
  constructor(db) {
    this.db = db;
  }

  async scan(collectionName, afterId, limit) {
    let query = this.db.collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(limit);
    if (afterId != null) query = query.startAfter(afterId);
    const snapshot = await query.get();
    return {
      documents: snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data(),
        ref: document.ref,
        updateTime: document.updateTime
      })),
      nextCursor: snapshot.size === limit ? snapshot.docs.at(-1).id : null
    };
  }

  async commit(updates) {
    const batch = this.db.batch();
    for (const { document, patch } of updates) {
      batch.update(document.ref, patch, { lastUpdateTime: document.updateTime });
    }
    await batch.commit();
  }
}

const createProductionRuntime = async (projectId) => {
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "moderation-status-backfill"
  );
  return {
    adapter: new FirestoreModerationStatusAdapter(getFirestore(app)),
    close: () => deleteApp(app)
  };
};

export const main = async (argumentsList = process.argv.slice(2), dependencies = {}) => {
  const options = parseArguments(argumentsList);
  const projectId = resolveProjectId(dependencies.env ?? process.env);
  const runtime = await (dependencies.createRuntime ?? createProductionRuntime)(projectId);
  try {
    return await (dependencies.runner ?? runModerationStatusBackfill)({
      adapter: runtime.adapter,
      apply: options.apply
    });
  } finally {
    await runtime.close?.();
  }
};

const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main()
  .then((result) => { console.log(fixedResultSummary(result)); })
  .catch(() => { console.error("BACKFILL_FATAL"); process.exitCode = 1; });
