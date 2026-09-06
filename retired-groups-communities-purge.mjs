const RETIRED_COLLECTIONS = Object.freeze(["groups", "communities"]);

export const isRetiredCommunityPost = (data = {}) =>
  (typeof data.groupId === "string" && data.groupId.trim().length > 0)
  || (typeof data.communityId === "string" && data.communityId.trim().length > 0);

export const isPrivateGroupEnvelope = (data = {}) => data.kind === "privateGroup";

export const purgeRetiredCollections = async ({ db, logger = console }) => {
  if (!db) throw new Error("Firestore database is required.");
  const result = {
    collections: {},
    deletedRoots: 0,
    retiredCommunityPosts: 0,
    retiredCommunityVotes: 0,
    privateGroupEnvelopes: 0
  };

  for (const collectionName of RETIRED_COLLECTIONS) {
    const snapshot = await db.collection(collectionName).get();
    result.collections[collectionName] = snapshot.size;
    for (const document of snapshot.docs) {
      await db.recursiveDelete(document.ref);
      result.deletedRoots += 1;
    }
    logger.log(`PURGE_RETIRED_COLLECTION name=${collectionName} roots=${snapshot.size}`);
  }

  const retiredPostIds = new Set();
  const communityPosts = await db.collection("communityPosts").get();
  for (const document of communityPosts.docs) {
    if (!isRetiredCommunityPost(document.data() || {})) continue;
    retiredPostIds.add(document.id ?? String(document.ref?.path || "").split("/").at(-1));
    await db.recursiveDelete(document.ref);
    result.retiredCommunityPosts += 1;
  }
  logger.log(`PURGE_RETIRED_COMMUNITY_POSTS deleted=${result.retiredCommunityPosts}`);

  const communityVotes = await db.collection("communityVotes").get();
  for (const document of communityVotes.docs) {
    const data = document.data() || {};
    if (data.postCollection !== "communityPosts" || !retiredPostIds.has(data.postId)) continue;
    await db.recursiveDelete(document.ref);
    result.retiredCommunityVotes += 1;
  }
  logger.log(`PURGE_RETIRED_COMMUNITY_VOTES deleted=${result.retiredCommunityVotes}`);

  const envelopes = await db.collection("e2eeRoomKeyEnvelopes").get();
  for (const document of envelopes.docs) {
    if (!isPrivateGroupEnvelope(document.data() || {})) continue;
    await db.recursiveDelete(document.ref);
    result.privateGroupEnvelopes += 1;
  }
  logger.log(`PURGE_PRIVATE_GROUP_ENVELOPES deleted=${result.privateGroupEnvelopes}`);

  return result;
};
