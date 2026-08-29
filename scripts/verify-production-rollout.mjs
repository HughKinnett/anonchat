import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { verifyProductionRolloutState } from "../production-rollout-policy.mjs";

const projectId = process.env.GCLOUD_PROJECT || "anonchatlogin";
const app = initializeApp({ credential: applicationDefault(), projectId }, "production-rollout-verifier");

const main = async () => {
  const db = getFirestore(app);
  const paths = ["moderationStateBackfill", "roomLifecycleBackfill", "pollVoteSchemaMigration", "moderationProcessor"];
  const snapshots = await Promise.all(paths.map((id) => db.doc(`system/${id}`).get()));
  verifyProductionRolloutState(Object.fromEntries(paths.map((id, index) => [id, snapshots[index].data()])));
  console.log("PRODUCTION_ROLLOUT_GATES_VERIFIED");
};

main().catch(() => {
  console.error("PRODUCTION_ROLLOUT_VERIFICATION_FAILED");
  process.exitCode = 1;
}).finally(() => deleteApp(app));
