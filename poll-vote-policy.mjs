export const POLL_VOTE_SCHEMA_VERSION = 1;
export const POLL_POST_COLLECTIONS = Object.freeze(["posts", "communityPosts"]);

const safeSegment = (value) => typeof value === "string" && value.length > 0 && !value.includes("/");

export const pollVoteDocumentId = (postCollection, postId, uid) => {
  if (!POLL_POST_COLLECTIONS.includes(postCollection) || !safeSegment(postId) || !safeSegment(uid)) {
    throw new Error("INVALID_POLL_VOTE_ID");
  }
  return `${postCollection}:${postId}:${uid}`;
};

export const canonicalPollVote = ({ postCollection, postId, uid, option, createdAt }) => {
  if (!POLL_POST_COLLECTIONS.includes(postCollection) || !safeSegment(postId) || !safeSegment(uid)
    || !Number.isInteger(option) || option < 0 || option > 3 || createdAt === undefined) {
    throw new Error("INVALID_POLL_VOTE");
  }
  return { postCollection, postId, uid, option, createdAt };
};
