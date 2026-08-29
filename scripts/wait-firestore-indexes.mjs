import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gcloudCompositeIndexListArguments, waitForRequiredIndexes } from "../production-rollout-policy.mjs";

const executeFile = promisify(execFile);
const projectId = process.env.GCLOUD_PROJECT || "anonchatlogin";
const timeoutSeconds = Number(process.env.FIRESTORE_INDEX_TIMEOUT_SECONDS || "1200");

const main = async () => {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) throw new Error("INVALID_INDEX_WAIT_BOUND");
  const config = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  await waitForRequiredIndexes({
    requiredIndexes: config.indexes,
    timeoutMs: timeoutSeconds * 1000,
    listIndexes: async ({ timeoutMs }) => {
      const { stdout } = await executeFile("gcloud", gcloudCompositeIndexListArguments(projectId), {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs
      });
      const indexes = JSON.parse(stdout);
      if (!Array.isArray(indexes)) throw new Error("INVALID_INDEX_LIST");
      return indexes;
    }
  });
  console.log("FIRESTORE_INDEXES_READY");
};

main().catch(() => {
  console.error("FIRESTORE_INDEX_READINESS_FAILED");
  process.exitCode = 1;
});
