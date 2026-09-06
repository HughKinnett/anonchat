import { normalizePostMedia, validatePostMedia } from "./post-media-policy.mjs";
import { postTopics } from "./topic-policy.mjs";

const resolvedMedia = (media = [], imageData = "") => {
  const normalized = normalizePostMedia(media);
  const validation = validatePostMedia(normalized);
  if (!validation.ok) throw new Error(validation.reason);
  return {
    media: normalized,
    imageData: normalized[0]?.url || imageData || ""
  };
};

export const buildOriginalPost = ({ authorId, username, content, imageData, media, category, options, expiresAt, createdAt, topics }) => {
  const resolved = resolvedMedia(media, imageData);
  const post = {
    type: "original",
    authorId,
    username,
    content,
    imageData: resolved.imageData,
    ...(resolved.media.length ? { media: resolved.media } : {}),
    category,
    options,
    expiresAt,
    moderationState: "visible",
    createdAt,
    topics
  };
  return { ...post, topics: postTopics(post) };
};

export const buildRepost = ({ authorId, username, sourceCollection, originalPostId, originalAuthorId, originalUsername, content, imageData, media, createdAt, topics }) => {
  const resolved = resolvedMedia(media, imageData);
  const post = {
    type: "repost",
    authorId,
    username,
    sourceCollection,
    originalPostId,
    originalAuthorId,
    originalUsername,
    content,
    imageData: resolved.imageData,
    ...(resolved.media.length ? { media: resolved.media } : {}),
    moderationState: "visible",
    createdAt,
    topics
  };
  return { ...post, topics: postTopics(post) };
};
