const stableEntryId = (postPath = "") => encodeURIComponent(String(postPath).trim());

export const savedPostEntryId = (postPath) => stableEntryId(postPath);
export const historyEntryId = (postPath) => stableEntryId(postPath);

export const canonicalPostPathParts = (postPath = "") => {
  const parts = String(postPath).trim().split("/");
  if (parts.length !== 2 || !parts[1]) return null;
  if (!['posts', 'communityPosts'].includes(parts[0])) return null;
  return { collection: parts[0], id: parts[1] };
};

export const mergeHistoryEntries = (entries = [], next = {}, limit = 100) => {
  const postPath = String(next?.postPath || "").trim();
  if (!postPath) return [...entries].slice(0, Math.max(0, limit));
  const viewedAt = Number(next?.viewedAt) || 0;
  const merged = [
    { ...next, postPath, viewedAt },
    ...entries.filter((entry) => String(entry?.postPath || "") !== postPath)
  ];
  merged.sort((a, b) => Number(b?.viewedAt || 0) - Number(a?.viewedAt || 0));
  return merged.slice(0, Math.max(0, Number(limit) || 0));
};
