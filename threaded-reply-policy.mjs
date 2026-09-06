const idOf = (record = {}) => String(record.id || record.commentId || "");
const createdAtMs = (record = {}) => Number(record.createdAtMs ?? record.createdAt?.toMillis?.() ?? 0);

export const threadRootId = (comment = {}) =>
  String(comment.threadRootId || comment.parentCommentId || idOf(comment));

export const buildReplyRecord = ({ content = "", authorId = "", parentCommentId = "", parent = {} } = {}) => ({
  content: String(content),
  authorId: String(authorId),
  parentCommentId: String(parentCommentId),
  threadRootId: threadRootId(parent)
});

export const groupCommentThreads = (comments = []) => {
  const normalized = comments.map((comment) => ({ ...comment, id: idOf(comment) }));
  const roots = normalized
    .filter((comment) => !comment.parentCommentId)
    .sort((a, b) => createdAtMs(a) - createdAtMs(b));
  const repliesByRoot = new Map();
  for (const comment of normalized) {
    if (!comment.parentCommentId) continue;
    const rootId = threadRootId(comment);
    if (!repliesByRoot.has(rootId)) repliesByRoot.set(rootId, []);
    repliesByRoot.get(rootId).push(comment);
  }
  for (const replies of repliesByRoot.values()) replies.sort((a, b) => createdAtMs(a) - createdAtMs(b));
  return roots.map((root) => ({ root, replies: repliesByRoot.get(root.id) || [] }));
};
