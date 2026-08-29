const repostSourceCollection = (post) =>
  post?.sourceCollection === "communityPosts" ? "communityPosts" : "posts";

export const interactionParentForPost = (postDoc) => {
  const post = postDoc.data();
  if (post.type === "repost") {
    const collection = repostSourceCollection(post);
    return {
      collection,
      id: post.originalPostId,
      path: `${collection}/${post.originalPostId}`
    };
  }

  return {
    collection: postDoc.ref.parent.id,
    id: postDoc.id,
    path: postDoc.ref.path
  };
};
