import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const indexes = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8")).indexes;
const fields = index => index.fields.map(field => `${field.fieldPath}:${field.order}`).join("|");
assert.ok(indexes.some(index => index.collectionGroup === "reports"
  && index.queryScope === "COLLECTION"
  && fields(index) === "targetType:ASCENDING|targetId:ASCENDING"),
"target-wide report cleanup requires its deployed compound index");
assert.ok(indexes.some(index => index.collectionGroup === "communityVotes"
  && index.queryScope === "COLLECTION"
  && fields(index) === "postId:ASCENDING|postCollection:ASCENDING"),
"discriminated vote cleanup requires the live collection compound index");
assert.ok(indexes.some(index => index.collectionGroup === "roomMessages"
  && index.queryScope === "COLLECTION"
  && fields(index) === "roomId:ASCENDING|createdAt:ASCENDING"),
"reported-room evidence is paged chronologically by room");
assert.ok(indexes.some(index => index.collectionGroup === "moderationDeletionJobs"
  && index.queryScope === "COLLECTION"
  && fields(index) === "status:ASCENDING|requestedAt:DESCENDING"),
"the bounded active-job listener requires its production index");

console.log("Moderation deletion index contract passed");
