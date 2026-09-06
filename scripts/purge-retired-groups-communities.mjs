import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const RETIRED_COLLECTIONS = Object.freeze(["groups", "communities"]);

const resolveProjectId = (environment = process.env) => {
  const direct = environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  try {
    const configured = JSON.parse(environment.FIREBASE_CONFIG ?? "{}").projectId;
    if (typeof configured === "string" && configured.trim()) return configured.trim();
  } catch {}
  return "anonchatlogin";
};

const isRetiredCommunityPost = (data = {}) =>
  (typeof data.groupId === "string" && data.groupId.trim().length > 0)
  || (typeof data.communityId === "string" && data.communityId.trim().length > 0);

export const purgeRetiredCollections = async ({ db, logger = console }) => {
  if (!db) throw new Error("Firestore database is required.");
  const result = { collections: {}, deletedRoots: 0, retiredCommunityPosts: 0 };

  for (const collectionName of RETIRED_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    result.collections[collectionName] = snapshot.size;
    for (const document of snapshot.docs) {
      await db.recursiveDelete(document.ref);
      result.deletedRoots += 1;
    }
    logger.log(`PURGE_RETIRED_COLLECTION name=${collectionName} roots=${snapshot.size}`);
  }

  const communityPosts = await db.collection("communityPosts").get();
  for (const document of communityPosts.docs) {
    if (!isRetiredCommunityPost(document.data() || {})) continue;
    await db.recursiveDelete(document.ref);
    result.retiredCommunityPosts += 1;
  }
  logger.log(`PURGE_RETIRED_COMMUNITY_POSTS deleted=${result.retiredCommunityPosts}`);

  return result;
};

export const main = async (dependencies = {}) => {
  const projectId = resolveProjectId(dependencies.env ?? process.env);
  const app = initializeApp({ credential: applicationDefault(), projectId });
  try {
    const db = getFirestore(app);
    const result = await purgeRetiredCollections({ db, logger: dependencies.logger ?? console });
    console.log(`PURGE_RETIRED_RESULT groups=${result.collections.groups ?? 0} communities=${result.collections.communities ?? 0} communityPosts=${result.retiredCommunityPosts} deletedRoots=${result.deletedRoots}`);
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
