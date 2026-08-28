import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanupQueries } from "../admin-deletion-processor-policy.mjs";

const firebaseConfig = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
assert.equal(firebaseConfig.firestore.indexes, "firestore.indexes.json");
assert.equal(firebaseConfig.hosting.ignore.includes("firestore.indexes.json"), true);
const indexConfig = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
assert.equal(Array.isArray(indexConfig.indexes), true);
const configured = new Set(indexConfig.fieldOverrides.map((field) => {
  assert.equal(field.indexes.length, 1);
  assert.deepEqual(field.indexes[0], { order: "ASCENDING", queryScope: "COLLECTION_GROUP" });
  return `${field.collectionGroup}:${field.fieldPath}`;
}));
const required = new Set(cleanupQueries("target", "target_name")
  .filter((entry) => entry.group)
  .map((entry) => `${entry.collection}:${entry.field}`));
for (const index of required) assert.equal(configured.has(index), true, `${index} remains configured for deletion cleanup`);
console.log("Administrator deletion collection-group index contract passed");
