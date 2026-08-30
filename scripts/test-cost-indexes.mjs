import assert from "node:assert/strict";
import fs from "node:fs";

const indexes = JSON.parse(fs.readFileSync(new URL("../firestore.indexes.json", import.meta.url)));
const exemptions = new Set(
  indexes.fieldOverrides
    .filter((entry) => Array.isArray(entry.indexes) && entry.indexes.length === 0)
    .map((entry) => `${entry.collectionGroup}.${entry.fieldPath}`)
);

const largeUnqueriedFields = [
  "users.profileImage",
  "users.coverImage",
  "posts.imageData",
  "posts.content",
  "posts.options",
  "communityPosts.imageData",
  "communityPosts.content",
  "roomMessages.imageData",
  "roomMessages.text",
  "messages.imageData",
  "messages.text",
  "comments.text",
  "replies.text"
];

for (const field of largeUnqueriedFields) {
  assert.ok(exemptions.has(field), `${field} must stay exempt from automatic indexing`);
}

console.log("Firebase cost index policy tests passed.");
