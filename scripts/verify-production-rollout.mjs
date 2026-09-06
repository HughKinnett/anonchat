import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFile, writeFile } from "node:fs/promises";
import { verifyProductionRolloutState } from "../production-rollout-policy.mjs";
import { hardenRetiredFeatureRules } from "./retired-feature-rules-hardening.mjs";

const projectId = process.env.GCLOUD_PROJECT || "anonchatlogin";
const app = initializeApp({ credential: applicationDefault(), projectId }, "production-rollout-verifier");

const hardenRulesForDeployment = async () => {
  const rulesUrl = new URL("../firestore.rules", import.meta.url);
  const before = await readFile(rulesUrl, "utf8");
  const after = hardenRetiredFeatureRules(before);
  await writeFile(rulesUrl, after);
};

const main = async () => {
  await hardenRulesForDeployment();
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
