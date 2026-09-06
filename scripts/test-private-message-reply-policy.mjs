import assert from "node:assert/strict";
import { resolveReplyPreview } from "../private-message-reply-policy.mjs";

assert.deepEqual(
  resolveReplyPreview({ replyToMessageId: "m1", replyToSenderId: "alice", replyToSnippet: "hello" }, { id: "m1", senderId: "alice", text: "hello there" }),
  { state: "available", senderLabel: "alice", snippet: "hello there" }
);
assert.deepEqual(
  resolveReplyPreview({ replyToMessageId: "m1", replyToSenderId: "alice", replyToSnippet: "hello" }, { id: "m1", senderId: "alice", unsentAt: 123 }),
  { state: "unavailable", senderLabel: "alice", snippet: "Original message unavailable." }
);
assert.deepEqual(
  resolveReplyPreview({ replyToMessageId: "m1", replyToSenderId: "alice", replyToSnippet: "hello" }, null),
  { state: "unavailable", senderLabel: "alice", snippet: "Original message unavailable." }
);
console.log("private message reply policy tests passed");
