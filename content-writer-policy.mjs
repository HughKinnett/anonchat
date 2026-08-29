export const buildOriginalPost = ({ authorId, username, content, imageData, category, options, expiresAt, createdAt }) => ({
  type: "original",
  authorId,
  username,
  content,
  imageData,
  category,
  options,
  expiresAt,
  moderationState: "visible",
  createdAt
});

export const buildRepost = ({ authorId, username, sourceCollection, originalPostId, originalAuthorId, originalUsername, content, imageData, createdAt }) => ({
  type: "repost",
  authorId,
  username,
  sourceCollection,
  originalPostId,
  originalAuthorId,
  originalUsername,
  content,
  imageData,
  moderationState: "visible",
  createdAt
});
