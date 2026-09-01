const SETTINGS_KEY = "anonchat:experience:v1";
const BOOKMARKS_KEY = "anonchat:bookmarks:v1";
const ACTIVITY_KEY = "anonchat:contribution-days:v1";

export const experienceDefaults = Object.freeze({
  dataSaver: false,
  compactMode: false,
  highContrast: false,
  reducedMotion: false,
  largeText: false,
  readableFont: false,
  quietMode: false
});

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

export const readExperienceSettings = () => ({ ...experienceDefaults, ...readJson(SETTINGS_KEY, {}) });
export const saveExperienceSettings = (settings) => {
  const clean = Object.fromEntries(Object.keys(experienceDefaults).map((key) => [key, Boolean(settings[key])]));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
  applyExperienceSettings(document, clean);
  return clean;
};

export const applyExperienceSettings = (root = document, supplied = readExperienceSettings()) => {
  const target = root.documentElement || root;
  Object.keys(experienceDefaults).forEach((key) => target.classList.toggle(`ac-${key.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)}`, Boolean(supplied[key])));
};

export const readBookmarks = () => readJson(BOOKMARKS_KEY, []).filter((item) => item?.path).slice(0, 250);
export const isBookmarked = (path) => readBookmarks().some((item) => item.path === path);
export const toggleBookmark = (bookmark) => {
  const current = readBookmarks();
  const index = current.findIndex((item) => item.path === bookmark.path);
  if (index >= 0) current.splice(index, 1);
  else current.unshift({ path: String(bookmark.path), author: String(bookmark.author || "anonymous"), excerpt: String(bookmark.excerpt || "").slice(0, 180), savedAt: Date.now() });
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(current.slice(0, 250)));
  return index < 0;
};

export const recordContribution = (now = new Date()) => {
  const key = now.toISOString().slice(0, 10);
  const days = [...new Set([...readJson(ACTIVITY_KEY, []), key])].sort().slice(-366);
  localStorage.setItem(ACTIVITY_KEY, JSON.stringify(days));
  return contributionSummary(days);
};

export const contributionSummary = (supplied = readJson(ACTIVITY_KEY, []), now = new Date()) => {
  const days = new Set(supplied);
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (days.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
  return { streak, totalDays: days.size, badges: [streak >= 3 && "3-day voice", streak >= 7 && "7-day regular", streak >= 30 && "30-day presence"].filter(Boolean) };
};

applyExperienceSettings();
