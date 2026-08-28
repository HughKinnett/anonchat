import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { cleanupQueries } from "../admin-deletion-processor-policy.mjs";

const firebaseConfig = JSON.parse(await readFile(new URL("../firebase.json", import.meta.url), "utf8"));
assert.equal(firebaseConfig.firestore.indexes, "firestore.indexes.json");
const indexConfig = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
const configured = new Set(indexConfig.indexes.map((index) => {
  assert.equal(index.queryScope, "COLLECTION_GROUP");
  assert.equal(index.fields.length, 1);
  assert.equal(index.fields[0].order, "ASCENDING");
  return `${index.collectionGroup}:${index.fields[0].fieldPath}`;
}));
const required = new Set(cleanupQueries("target", "target_name")
  .filter((entry) => entry.group)
  .map((entry) => `${entry.collection}:${entry.field}`));
assert.deepEqual([...configured].sort(), [...required].sort());
assert.deepEqual(indexConfig.fieldOverrides, []);
console.log("Administrator deletion collection-group index contract passed");
