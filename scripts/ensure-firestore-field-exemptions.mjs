import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const projectId = process.env.GCLOUD_PROJECT || "anonchatlogin";

const main = async () => {
  const config = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
  const exemptions = config.fieldOverrides.filter((entry) => Array.isArray(entry.indexes) && entry.indexes.length === 0);
  for (const entry of exemptions) {
    await executeFile("gcloud", [
      "firestore", "indexes", "fields", "update", entry.fieldPath,
      `--collection-group=${entry.collectionGroup}`,
      "--database=(default)",
      "--disable-indexes",
      "--async",
      `--project=${projectId}`,
      "--quiet"
    ], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 120_000 });
  }
  console.log(`FIRESTORE_FIELD_EXEMPTIONS_ENSURED count=${exemptions.length}`);
};

main().catch((error) => {
  console.error("FIRESTORE_FIELD_EXEMPTIONS_FAILED", error?.stderr || error?.message || "unknown");
  process.exitCode = 1;
});
