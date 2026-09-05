import fs from "node:fs";

const path = "timeline.js";
let source = fs.readFileSync(path, "utf8");

const replaceOnce = (needle, replacement, label) => {
  if (!source.includes(needle)) throw new Error(`Could not locate ${label}`);
  source = source.replace(needle, () => replacement);
};

replaceOnce(
  'import { historyEntryId, savedPostEntryId } from "./saved-history-policy.mjs";',
  'import { canonicalPostPathParts, historyEntryId, savedPostEntryId } from "./saved-history-policy.mjs";',
  "Saved/History import"
);

replaceOnce(
  `let recentSearches = [];
let savedPostPaths = new Set();
let viewedPostPaths = [];`,
  `let recentSearches = [];
let savedPostPaths = new Set();
let viewedPostPaths = [];
let referencedPostDocs = new Map();`,
  "Saved/History state"
);

replaceOnce(
  `const blockedUid = (uid) => isBlockedActor(uid, viewerBlocks);
const visibleTimelinePosts = () => allTimelinePosts()
  .filter((post) => !post.data().expiresAt?.toMillis?.() || post.data().expiresAt.toMillis() > Date.now())
  .filter((post) => isBlockedPost(post, viewerBlocks))
  .filter((post) => reportCardStatuses.get(post.ref.path)?.hidden !== true);`,
  `const blockedUid = (uid) => isBlockedActor(uid, viewerBlocks);
const visibleTimelinePosts = () => [...new Map([
  ...allTimelinePosts(),
  ...referencedPostDocs.values()
].map((post) => [post.ref.path, post])).values()]
  .filter((post) => !post.data().expiresAt?.toMillis?.() || post.data().expiresAt.toMillis() > Date.now())
  .filter((post) => post.data().get?.("moderationState", "visible") !== "hidden" && post.data().moderationState !== "hidden")
  .filter((post) => isBlockedPost(post, viewerBlocks))
  .filter((post) => reportCardStatuses.get(post.ref.path)?.hidden !== true);`,
  "visible canonical post source"
);

replaceOnce(
  `const renderFeed = () => {`,
  `const loadReferencedPostDocs = async (paths = []) => {
  const uniquePaths = [...new Set(paths.map((path) => String(path || "").trim()).filter(Boolean))];
  const requested = uniquePaths
    .map((path) => ({ path, parts: canonicalPostPathParts(path) }))
    .filter((entry) => entry.parts);
  const next = new Map(referencedPostDocs);
  await Promise.all(requested.map(async ({ path, parts }) => {
    try {
      const snapshot = await getDoc(doc(db, parts.collection, parts.id));
      if (!snapshot.exists()
        || snapshot.data().moderationState === "hidden"
        || (snapshot.data().expiresAt?.toMillis?.() && snapshot.data().expiresAt.toMillis() <= Date.now())
        || !isBlockedPost(snapshot, viewerBlocks)) {
        next.delete(path);
        return;
      }
      next.set(path, snapshot);
    } catch {
      next.delete(path);
    }
  }));
  const stillReferenced = new Set([...savedPostPaths, ...viewedPostPaths]);
  for (const path of next.keys()) if (!stillReferenced.has(path)) next.delete(path);
  referencedPostDocs = next;
  syncInteractionListeners();
  renderFeed();
  void hydrateVisibleAuthorMetadata();
};

const renderFeed = () => {`,
  "renderFeed anchor"
);

replaceOnce(
  `  savedPostPaths = new Set();
  viewedPostPaths = [];`,
  `  savedPostPaths = new Set();
  viewedPostPaths = [];
  referencedPostDocs = new Map();`,
  "resource cleanup state"
);

replaceOnce(
  `(snapshot) => { savedPostPaths = new Set(snapshot.docs.map((entry) => entry.data().postPath).filter(Boolean)); renderFeed(); },`,
  `(snapshot) => {
      savedPostPaths = new Set(snapshot.docs.map((entry) => entry.data().postPath).filter(Boolean));
      void loadReferencedPostDocs([...savedPostPaths]);
      renderFeed();
    },`,
  "Saved listener callback"
);

replaceOnce(
  `(snapshot) => { viewedPostPaths = snapshot.docs.map((entry) => entry.data().postPath).filter(Boolean); if (feedMode === "history") renderFeed(); },`,
  `(snapshot) => {
      viewedPostPaths = snapshot.docs.map((entry) => entry.data().postPath).filter(Boolean);
      void loadReferencedPostDocs(viewedPostPaths);
      if (feedMode === "history") renderFeed();
    },`,
  "History listener callback"
);

fs.writeFileSync(path, source);
console.log("Applied canonical Saved and History reference loading");
