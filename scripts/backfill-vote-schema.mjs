import { pathToFileURL } from "node:url";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { runVoteSchemaBackfill } from "../vote-schema-backfill-policy.mjs";

export const parseArguments = argumentsList => {
  const supported = new Set(["--apply"]);
  if (argumentsList.some(argument => !supported.has(argument))) throw new Error("INVALID_ARGUMENT");
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

export const fixedResultSummary = result => `VOTE_BACKFILL_RESULT mode=${result.mode} scanned=${result.scanned} eligible=${result.eligible} migrated=${result.migrated} ambiguous=${result.ambiguous} alreadyMigrated=${result.alreadyMigrated} batches=${result.batches}`;

class FirestoreVoteSchemaAdapter {
  constructor(db) { this.db = db; }

  async scan(afterId, limit) {
    let query = this.db.collection("communityVotes").orderBy(FieldPath.documentId()).limit(limit);
    if (afterId != null) query = query.startAfter(afterId);
    const snapshot = await query.get();
    return {
      documents: snapshot.docs.map(document => ({ id: document.id, data: document.data() })),
      nextCursor: snapshot.size === limit ? snapshot.docs.at(-1).id : null
    };
  }

  async targetPresence(postId) {
    if (typeof postId !== "string" || !postId) return { posts: false, communityPosts: false };
    const [post, communityPost] = await Promise.all([
      this.db.collection("posts").doc(postId).get(),
      this.db.collection("communityPosts").doc(postId).get()
    ]);
    return { posts: post.exists, communityPosts: communityPost.exists };
  }

  async commit(migrations) {
    for (const migration of migrations) {
      await this.db.runTransaction(async transaction => {
        const sourceRef = this.db.collection("communityVotes").doc(migration.fromId);
        const source = await transaction.get(sourceRef);
        if (!source.exists || source.data().postCollection !== undefined) return;
        const current = source.data();
        const [post, communityPost] = await Promise.all([
          transaction.get(this.db.collection("posts").doc(current.postId)),
          transaction.get(this.db.collection("communityPosts").doc(current.postId))
        ]);
        const matches = [post.exists, communityPost.exists].filter(Boolean).length;
        if (matches !== 1) return;
        const postCollection = post.exists ? "posts" : "communityPosts";
        const destinationRef = this.db.collection("communityVotes")
          .doc(`${postCollection}_${current.postId}_${current.uid}`);
        const destination = await transaction.get(destinationRef);
        if (!destination.exists) transaction.create(destinationRef, { ...current, postCollection });
        transaction.delete(sourceRef);
      });
    }
  }
}

const createProductionRuntime = async projectId => {
  const app = initializeApp({ credential: applicationDefault(), projectId }, "vote-schema-backfill");
  return { adapter: new FirestoreVoteSchemaAdapter(getFirestore(app)), close: () => deleteApp(app) };
};

export const main = async (argumentsList = process.argv.slice(2), dependencies = {}) => {
  const { apply } = parseArguments(argumentsList);
  const runtime = await (dependencies.createRuntime ?? createProductionRuntime)(
    resolveProjectId(dependencies.env ?? process.env)
  );
  try {
    return await (dependencies.runner ?? runVoteSchemaBackfill)({ adapter: runtime.adapter, apply });
  } finally {
    await runtime.close?.();
  }
};

const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main()
  .then(result => { console.log(fixedResultSummary(result)); })
  .catch(() => { console.error("VOTE_BACKFILL_FATAL"); process.exitCode = 1; });
