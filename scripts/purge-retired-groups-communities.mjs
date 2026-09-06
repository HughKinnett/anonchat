import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { purgeRetiredCollections } from "../retired-groups-communities-purge.mjs";

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
  const app = initializeApp({ credential: applicationDefault(), projectId });
  try {
    const db = getFirestore(app);
    const result = await purgeRetiredCollections({ db, logger: dependencies.logger ?? console });
    console.log(`PURGE_RETIRED_RESULT groups=${result.collections.groups ?? 0} communities=${result.collections.communities ?? 0} communityPosts=${result.retiredCommunityPosts} privateGroupEnvelopes=${result.privateGroupEnvelopes} deletedRoots=${result.deletedRoots}`);
    return result;
  } finally {
    await deleteApp(app);
  }
};

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error("PURGE_RETIRED_FATAL", error?.message || error);
    process.exitCode = 1;
  });
}
