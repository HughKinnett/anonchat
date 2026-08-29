import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  gcloudCompositeIndexCreateArguments,
  gcloudCompositeIndexListArguments,
  missingRequiredIndexes
} from "../production-rollout-policy.mjs";

const executeFile = promisify(execFile);
const projectId = process.env.GCLOUD_PROJECT || "anonchatlogin";

const main = async () => {
  const config = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const { stdout } = await executeFile("gcloud", gcloudCompositeIndexListArguments(projectId), {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 60_000
  });
  const remoteIndexes = JSON.parse(stdout);
  const missing = missingRequiredIndexes(config.indexes, remoteIndexes);
  for (const index of missing) {
    await executeFile("gcloud", gcloudCompositeIndexCreateArguments(projectId, index), {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 60_000
    });
  }
  console.log(`FIRESTORE_INDEX_CREATE_REQUESTED count=${missing.length}`);
};

main().catch(() => {
  console.error("FIRESTORE_INDEX_ENSURE_FAILED");
  process.exitCode = 1;
});
