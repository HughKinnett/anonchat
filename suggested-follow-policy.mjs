const DAY_MS = 86_400_000;
const cap = (value, max = 12) => Math.min(max, Math.max(0, Number(value) || 0));
const recencyMultiplier = (lastAffinityAtMs, now) => {
  const timestamp = Number(lastAffinityAtMs) || 0;
  if (!timestamp) return 0.5;
  const ageDays = Math.max(0, Number(now) - timestamp) / DAY_MS;
  return Math.max(0.25, Math.pow(0.5, ageDays / 30));
};

export const scoreFollowCandidate = (candidate = {}, context = {}) => {
  const now = Number(context.now) || Date.now();
  const social = cap(candidate.mutuals) * 5;
  const comments = cap(candidate.viewerComments) * 4;
  const reactions = cap(candidate.viewerReactions) * 2;
  const shared = cap(candidate.sharedInteractions) * 1.5;
  const legacyTopics = cap(candidate.sharedTopics) * 1.5;
  const legacyInteractions = cap(candidate.publicInteractions);
  const behavioral = comments + reactions + shared + legacyTopics + legacyInteractions;
  return social + behavioral * recencyMultiplier(candidate.lastAffinityAtMs, now);
};

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
    .map((candidate) => ({ ...candidate, score: scoreFollowCandidate(candidate, context) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || String(left.uid).localeCompare(String(right.uid)))
    .slice(0, Math.max(0, Number(limit) || 0));
};
