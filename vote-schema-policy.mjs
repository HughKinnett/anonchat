const TARGET_COLLECTIONS = new Set(["posts", "communityPosts"]);

const required = (value, label) => {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
};

export const voteDocumentId = ({ postCollection, postId, uid }) => {
  if (!TARGET_COLLECTIONS.has(postCollection)) throw new TypeError("A supported post collection is required");
  return `${postCollection}_${required(postId, "Post ID")}_${required(uid, "User ID")}`;
};

export const voteDocumentPlan = ({ postCollection, postId, uid, option, createdAt }) => {
  if (!Number.isInteger(option) || option < 0 || option > 3) throw new TypeError("A valid vote option is required");
  if (createdAt === undefined) throw new TypeError("A vote timestamp is required");
  return {
    id: voteDocumentId({ postCollection, postId, uid }),
    data: { postCollection, postId, uid, option, createdAt }
  };
};

export const legacyVoteTargetCollection = (vote, { postIds = new Set(), communityPostIds = new Set() } = {}) => {
  if (!vote || typeof vote.postId !== "string") return null;
  if (TARGET_COLLECTIONS.has(vote.postCollection)) return vote.postCollection;
  const timeline = postIds.has(vote.postId);
  const community = communityPostIds.has(vote.postId);
  return timeline === community ? null : timeline ? "posts" : "communityPosts";
};

export const voteBelongsToTarget = (vote, target, knownTargets) => Boolean(
  vote
  && target
  && vote.postId === target.postId
  && legacyVoteTargetCollection(vote, knownTargets) === target.postCollection
);
