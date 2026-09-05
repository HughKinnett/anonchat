import { postTopics } from "./topic-policy.mjs";

export const buildOriginalPost = ({ authorId, username, content, imageData, category, options, expiresAt, createdAt, topics }) => {
  const post = {
    type: "original",
    authorId,
    username,
    content,
    imageData,
    category,
    options,
    expiresAt,
    moderationState: "visible",
    createdAt,
    topics
  };
  return { ...post, topics: postTopics(post) };
};

export const buildRepost = ({ authorId, username, sourceCollection, originalPostId, originalAuthorId, originalUsername, content, imageData, createdAt, topics }) => {
  const post = {
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
    createdAt,
    topics
  };
  return { ...post, topics: postTopics(post) };
};
