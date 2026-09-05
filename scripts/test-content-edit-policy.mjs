import assert from "node:assert/strict";
import {
  buildEditHistorySnapshot,
  canEditOwnedContent,
  nextEditMetadata
} from "../content-edit-policy.mjs";

assert.equal(canEditOwnedContent({ uid: "u1" }, "u1"), true, "owner uid can edit own content");
assert.equal(canEditOwnedContent({ authorId: "u1" }, "u1"), true, "authorId owner can edit own content");
assert.equal(canEditOwnedContent({ authorId: "u1" }, "u2"), false, "non-owner cannot edit content");
assert.equal(canEditOwnedContent({}, "u1"), false, "content without an owner cannot be edited");

assert.deepEqual(
  nextEditMetadata({ editVersion: 2 }, 1700000000000),
  { editedAt: 1700000000000, editVersion: 3 },
  "edit metadata increments the version and records the edit time"
);

assert.deepEqual(
  buildEditHistorySnapshot({ content: "before", editVersion: 1 }, "u1", 1700000000000),
  { content: "before", editVersion: 1, editorUid: "u1", archivedAt: 1700000000000 },
  "history preserves the prior content and audit metadata"
);

assert.deepEqual(
  buildEditHistorySnapshot({ text: "legacy", editVersion: 0 }, "u1", 1700000000000),
  { content: "legacy", editVersion: 0, editorUid: "u1", archivedAt: 1700000000000 },
  "history supports legacy text-shaped records"
);

console.log("content edit policy contract passed");
