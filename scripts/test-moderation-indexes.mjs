import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
const required = ["posts", "communityPosts"];
for (const collectionGroup of required) {
  assert.ok(config.indexes.some((index) =>
    index.collectionGroup === collectionGroup
    && index.queryScope === "COLLECTION"
    && JSON.stringify(index.fields) === JSON.stringify([
      { fieldPath: "authorId", order: "ASCENDING" },
      { fieldPath: "moderationState", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" }
    ])
  ), `${collectionGroup} has the profile visibility index`);
  assert.ok(config.indexes.some((index) =>
    index.collectionGroup === collectionGroup
    && index.queryScope === "COLLECTION"
    && JSON.stringify(index.fields) === JSON.stringify([
      { fieldPath: "moderationState", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" }
    ])
  ), `${collectionGroup} has the visible timeline ordering index`);
}
for (const [collectionGroup, fields] of [
  ["rooms", [
    { fieldPath: "moderationState", order: "ASCENDING" },
    { fieldPath: "createdAt", order: "DESCENDING" },
    { fieldPath: "__name__", order: "ASCENDING" }
  ]],
  ["roomMessages", [
    { fieldPath: "moderationState", order: "ASCENDING" },
    { fieldPath: "createdAt", order: "ASCENDING" },
    { fieldPath: "__name__", order: "ASCENDING" }
  ]]
]) assert.ok(config.indexes.some((index) =>
  index.collectionGroup === collectionGroup && index.queryScope === "COLLECTION"
    && JSON.stringify(index.fields) === JSON.stringify(fields)
), `${collectionGroup} has the visible ordering index`);
assert.ok(config.indexes.some((index) => index.collectionGroup === "reportIntakes"
  && JSON.stringify(index.fields) === JSON.stringify([
    { fieldPath: "targetPath", order: "ASCENDING" },
    { fieldPath: "status", order: "ASCENDING" }
  ])), "reportIntakes has the lifecycle fence index");
assert.equal(config.indexes.some((index) => index.fields.length === 2
  && index.fields.some((field) => field.fieldPath === "__name__")
  && index.fields[0].order === index.fields[1].order), false,
"single-field queries rely on Firestore's built-in document-name ordering instead of undeployable composites");
assert.ok(config.indexes.some((index) => index.collectionGroup === "rooms"
  && JSON.stringify(index.fields) === JSON.stringify([
    { fieldPath: "cleanupState", order: "ASCENDING" },
    { fieldPath: "cleanupLeaseExpiresAt", order: "ASCENDING" },
    { fieldPath: "__name__", order: "ASCENDING" }
  ])), "stale room-closing leases have a bounded recovery index");
assert.ok(config.indexes.some((index) => index.collectionGroup === "roomMessages"
  && JSON.stringify(index.fields) === JSON.stringify([
    { fieldPath: "roomId", order: "ASCENDING" },
    { fieldPath: "createdAt", order: "ASCENDING" },
    { fieldPath: "__name__", order: "ASCENDING" }
  ])), "administrator room transcripts have a bounded deterministic pagination index");
console.log("Moderation profile index contract passed");
