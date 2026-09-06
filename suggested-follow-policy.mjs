export const scoreFollowCandidate = (candidate = {}) =>
  Math.max(0, Number(candidate.mutuals) || 0) * 4
  + Math.max(0, Number(candidate.sharedTopics) || 0) * 2
  + Math.max(0, Number(candidate.publicInteractions) || 0);

export const suggestFollowCandidates = (candidates = [], context = {}, limit = 10) => {
  const viewerUid = String(context.viewerUid || "");
  const followedUids = context.followedUids instanceof Set
    ? context.followedUids
    : new Set(context.followedUids || []);
  const blockedUids = context.blockedUids instanceof Set
    ? context.blockedUids
    : new Set(context.blockedUids || []);

  return (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => {
      const uid = String(candidate?.uid || "");
      return uid && uid !== viewerUid && !followedUids.has(uid) && !blockedUids.has(uid);
    })
    .map((candidate) => ({ ...candidate, score: scoreFollowCandidate(candidate) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || String(left.uid).localeCompare(String(right.uid)))
    .slice(0, Math.max(0, Number(limit) || 0));
};
