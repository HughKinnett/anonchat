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
for (const [collectionGroup, fields] of [
  ["reportIntakes", [{ fieldPath: "targetPath", order: "ASCENDING" }, { fieldPath: "status", order: "ASCENDING" }]],
  ["legacyRoomQuarantine", [{ fieldPath: "status", order: "ASCENDING" }, { fieldPath: "__name__", order: "ASCENDING" }]]
]) assert.ok(config.indexes.some((index) => index.collectionGroup === collectionGroup
  && JSON.stringify(index.fields) === JSON.stringify(fields)), `${collectionGroup} has the lifecycle fence index`);
assert.ok(config.indexes.some((index) => index.collectionGroup === "rooms"
  && JSON.stringify(index.fields) === JSON.stringify([
    { fieldPath: "cleanupState", order: "ASCENDING" },
    { fieldPath: "cleanupLeaseExpiresAt", order: "ASCENDING" },
    { fieldPath: "__name__", order: "ASCENDING" }
  ])), "stale room-closing leases have a bounded recovery index");
console.log("Moderation profile index contract passed");
