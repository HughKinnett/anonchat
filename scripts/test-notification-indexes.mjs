import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexes = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
for (const collectionGroup of ["comments", "reactions"]) {
  assert.ok(indexes.fieldOverrides.some((entry) => entry.collectionGroup === collectionGroup
    && entry.fieldPath === "createdAt"
    && entry.indexes?.some((index) => index.order === "ASCENDING" && index.queryScope === "COLLECTION_GROUP")),
  `${collectionGroup}.createdAt supports trusted collection-group cursor ordering`);
}
assert.ok(indexes.indexes.some((index) => index.collectionGroup === "notificationEvents"
  && index.queryScope === "COLLECTION"
  && JSON.stringify(index.fields) === JSON.stringify([
    { fieldPath: "status", order: "ASCENDING" },
    { fieldPath: "updatedAt", order: "ASCENDING" }
  ])), "delivered-event retention cleanup has its production index");

console.log("Notification Firestore indexes passed");
