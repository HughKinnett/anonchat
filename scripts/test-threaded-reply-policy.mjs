import assert from "node:assert/strict";
import { buildReplyRecord, groupCommentThreads, threadRootId } from "../threaded-reply-policy.mjs";

assert.equal(threadRootId({ id: "c1" }), "c1", "top-level comments are their own thread roots");
assert.equal(threadRootId({ id: "r1", parentCommentId: "c1", threadRootId: "c1" }), "c1", "replies resolve to the top-level root");

const directReply = buildReplyRecord({
  content: "first reply",
  authorId: "u2",
  parentCommentId: "c1",
  parent: { id: "c1" }
});
assert.equal(directReply.threadRootId, "c1");
assert.equal(directReply.parentCommentId, "c1");

const replyToReply = buildReplyRecord({
  content: "reply to reply",
  authorId: "u3",
  parentCommentId: "r1",
  parent: { id: "r1", parentCommentId: "c1", threadRootId: "c1" }
});
assert.equal(replyToReply.threadRootId, "c1", "reply-to-reply stays in the same visible thread");
assert.equal(replyToReply.parentCommentId, "r1", "direct reply target is retained for context");

const grouped = groupCommentThreads([
  { id: "c2", content: "second root", createdAtMs: 20 },
  { id: "r2", content: "second reply", parentCommentId: "c1", threadRootId: "c1", createdAtMs: 30 },
  { id: "c1", content: "first root", createdAtMs: 10 },
  { id: "r1", content: "first reply", parentCommentId: "c1", threadRootId: "c1", createdAtMs: 20 }
]);
assert.deepEqual(grouped.map((thread) => thread.root.id), ["c1", "c2"], "root comments stay oldest-first");
assert.deepEqual(grouped[0].replies.map((reply) => reply.id), ["r1", "r2"], "replies stay oldest-first within one visible level");

console.log("threaded reply policy contract passed");
