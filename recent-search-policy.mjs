export const normalizeRecentSearch = (value = "") =>
  String(value).trim().replace(/\s+/g, " ").toLowerCase();

export const mergeRecentSearches = (entries = [], next = "", limit = 20) => {
  const normalizedNext = normalizeRecentSearch(next);
  const normalizedEntries = (Array.isArray(entries) ? entries : [])
    .map(normalizeRecentSearch)
    .filter(Boolean);
  const merged = normalizedNext
    ? [normalizedNext, ...normalizedEntries.filter((entry) => entry !== normalizedNext)]
    : normalizedEntries;
  return [...new Set(merged)].slice(0, Math.max(0, Number(limit) || 0));
};

export const removeRecentSearch = (entries = [], value = "") => {
  const target = normalizeRecentSearch(value);
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeRecentSearch)
    .filter((entry) => entry && entry !== target);
};
