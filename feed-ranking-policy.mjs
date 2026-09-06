const DAY_MS = 24 * 60 * 60 * 1000;

const dataFor = record => typeof record?.data === "function" ? record.data() : (record?.data || record || {});
const pathFor = record => record?.ref?.path || record?.path || String(record?.id || "");
const authorFor = record => {
  const post = dataFor(record);
  return post.type === "repost" ? post.originalAuthorId : post.authorId;
};
const millisFor = value => {
  try {
    const valueMs = typeof value?.toMillis === "function" ? value.toMillis() : value instanceof Date ? value.getTime() : Number(value);
    return Number.isFinite(valueMs) ? valueMs : 0;
  } catch { return 0; }
};
const stableUnit = value => {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 4294967295;
};
const clampCount = value => Math.min(50, Math.max(0, Number(value) || 0));

export const scoreFeedPost = (record, context = {}) => {
  const post = dataFor(record);
  const now = Number(context.now) || Date.now();
  const ageHours = Math.max(0, now - millisFor(post.createdAt)) / 3_600_000;
  const recency = 8 * Math.pow(0.5, ageHours / 18);
  const authorId = authorFor(record);
  const isFollowed = Boolean(context.followedUids?.has(authorId));
  const followed = isFollowed ? 4.2 : 0;
  const ownPost = authorId === context.viewerUid ? 0.45 : 0;
  const reactions = clampCount(context.reactionCounts?.get(pathFor(record)));
  const comments = clampCount(context.commentCounts?.get(pathFor(record)));
  const engagement = Math.min(4.5, Math.log1p(reactions) * 0.8 + Math.log1p(comments) * 1.25);
  const conversation = comments > 0 ? 0.55 : 0;
  const media = post.imageData ? 0.45 : 0;
  const poll = post.category === "Poll" ? 0.55 : 0;
  const substance = Math.min(0.65, String(post.content || "").trim().length / 500);
  const affinity = Math.min(6, Math.max(0, Number(context.authorAffinity?.get(authorId)) || 0));
  const similarAffinity = Math.min(3, Math.max(0, Number(context.similarAuthorAffinity?.get(authorId)) || 0));
  const discoveryAffinity = !isFollowed && authorId !== context.viewerUid
    ? affinity * 0.9 + similarAffinity * 0.6
    : 0;
  const exploration = !isFollowed && authorId !== context.viewerUid
    ? stableUnit(`${context.viewerUid || "visitor"}:${pathFor(record)}:${Math.floor(now / DAY_MS)}`) * 1.15
    : 0;
  const repostPenalty = post.type === "repost" ? -0.35 : 0;
  return recency + followed + ownPost + engagement + conversation + media + poll + substance + discoveryAffinity + exploration + repostPenalty;
};

export const rankFeedPosts = (posts, context = {}) => {
  const scored = posts.map((record, originalIndex) => ({
    record,
    originalIndex,
    authorId: authorFor(record),
    score: scoreFeedPost(record, context)
  })).sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex);

  const ranked = [];
  while (scored.length) {
    const previous = ranked.at(-1)?.authorId;
    const beforePrevious = ranked.at(-2)?.authorId;
    const avoid = previous && previous === beforePrevious ? previous : "";
    let index = avoid ? scored.findIndex(candidate => candidate.authorId !== avoid) : 0;
    if (index < 0) index = 0;
    ranked.push(scored.splice(index, 1)[0]);
  }
  return ranked.map(entry => entry.record);
};

export const blendRecommendedPosts = (normalPosts = [], recommendedPosts = [], { interval = 5 } = {}) => {
  const normal = Array.isArray(normalPosts) ? [...normalPosts] : [];
  const recommended = Array.isArray(recommendedPosts) ? [...recommendedPosts] : [];
  const step = Math.max(1, Number(interval) || 5);
  if (!normal.length || !recommended.length) return normal;

  const blended = [];
  let normalsSinceRecommendation = 0;
  let lastRecommendedAuthor = "";

  for (const record of normal) {
    blended.push(record);
    normalsSinceRecommendation += 1;
    if (normalsSinceRecommendation < step || !recommended.length) continue;

    let index = 0;
    if (lastRecommendedAuthor) {
      const alternative = recommended.findIndex(candidate => authorFor(candidate) !== lastRecommendedAuthor);
      if (alternative >= 0) index = alternative;
    }
    const [next] = recommended.splice(index, 1);
    blended.push(next);
    lastRecommendedAuthor = authorFor(next);
    normalsSinceRecommendation = 0;
  }

  return blended;
};
