const DAY_MS = 24 * 60 * 60 * 1000;

const dataFor = record => typeof record?.data === "function" ? record.data() : (record?.data || record || {});
const pathFor = record => record?.ref?.path || record?.path || String(record?.id || "");
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
  const authorId = post.type === "repost" ? post.originalAuthorId : post.authorId;
  const followed = context.followedUids?.has(authorId) ? 4.2 : 0;
  const ownPost = authorId === context.viewerUid ? 0.45 : 0;
  const reactions = clampCount(context.reactionCounts?.get(pathFor(record)));
  const comments = clampCount(context.commentCounts?.get(pathFor(record)));
  const engagement = Math.min(4.5, Math.log1p(reactions) * 0.8 + Math.log1p(comments) * 1.25);
  const conversation = comments > 0 ? 0.55 : 0;
  const media = post.imageData ? 0.45 : 0;
  const poll = post.category === "Poll" ? 0.55 : 0;
  const substance = Math.min(0.65, String(post.content || "").trim().length / 500);
  const exploration = !followed && authorId !== context.viewerUid
    ? stableUnit(`${context.viewerUid || "visitor"}:${pathFor(record)}:${Math.floor(now / DAY_MS)}`) * 1.15
    : 0;
  const repostPenalty = post.type === "repost" ? -0.35 : 0;
  return recency + followed + ownPost + engagement + conversation + media + poll + substance + exploration + repostPenalty;
};

export const rankFeedPosts = (posts, context = {}) => {
  const scored = posts.map((record, originalIndex) => ({
    record,
    originalIndex,
    authorId: dataFor(record).type === "repost" ? dataFor(record).originalAuthorId : dataFor(record).authorId,
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
