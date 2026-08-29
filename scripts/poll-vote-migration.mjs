import { pathToFileURL } from "node:url";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestorePollVoteMigrator } from "../poll-vote-migration.mjs";

export const main = async (environment = process.env) => {
  const projectId = String(environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT || "").trim();
  if (projectId !== "anonchatlogin") throw new Error("INVALID_PROJECT");
  const app = initializeApp({ credential: applicationDefault(), projectId }, `poll-vote-migration-${crypto.randomUUID()}`);
  try {
    return await new FirestorePollVoteMigrator({ db: getFirestore(app), Timestamp, FieldPath }).run();
  } finally {
    await deleteApp(app);
  }
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().then((result) => console.log(`POLL_VOTE_MIGRATION migrated=${result.migrated} ambiguous=${result.ambiguous} orphaned=${result.orphaned}`))
    .catch(() => { console.error("POLL_VOTE_MIGRATION_FAILED"); process.exitCode = 1; });
}
