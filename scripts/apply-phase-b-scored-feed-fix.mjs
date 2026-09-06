import fs from "node:fs";

const path = "timeline.js";
let source = fs.readFileSync(path, "utf8");

const replaceOnce = (before, after, label) => {
  if (!source.includes(before) && !source.includes(after)) throw new Error(`Could not locate ${label}`);
  if (source.includes(before)) source = source.replace(before, after);
};

replaceOnce(
  'import { filterFeedPosts, sortFeedPosts } from "./feed-mode-policy.mjs";',
  'import { filterFeedPosts, sortFeedPosts, sortScoredFeedPosts } from "./feed-mode-policy.mjs";',
  "feed policy import"
);

replaceOnce(
  'let communityPostDocs = [];',
  'let communityPostDocs = [];\nlet discoveryPostDocs = [];\nlet discoveryCommunityPostDocs = [];',
  "discovery document state"
);

replaceOnce(
  'const DISCOVERY_POST_LIMIT = 100;',
  'const TIMELINE_POST_LIMIT = 20;\nconst DISCOVERY_POST_LIMIT = 100;',
  "timeline and discovery limits"
);

replaceOnce(
  'const allTimelinePosts = () => [...postDocs, ...communityPostDocs];',
  'const allTimelinePosts = () => [...postDocs, ...communityPostDocs];\nconst discoveryTimelinePosts = () => [...discoveryPostDocs, ...discoveryCommunityPostDocs];',
  "discovery post source"
);

replaceOnce(
  'const visibleTimelinePosts = () => [...new Map([\n  ...allTimelinePosts(),\n  ...referencedPostDocs.values()\n].map((post) => [post.ref.path, post])).values()]',
  'const visibleTimelinePosts = (posts = allTimelinePosts()) => [...new Map([\n  ...posts,\n  ...referencedPostDocs.values()\n].map((post) => [post.ref.path, post])).values()]',
  "visible post source parameter"
);

replaceOnce(
  '  const posts = visibleTimelinePosts().sort(compareNewestFirst);',
  '  const interactionFeedPosts = ["trending", "popular-today", "topics"].includes(feedMode) ? discoveryTimelinePosts() : allTimelinePosts();\n  const posts = visibleTimelinePosts(interactionFeedPosts).sort(compareNewestFirst);',
  "interaction active-feed source"
);

replaceOnce(
  '  const unexpiredPosts = visibleTimelinePosts().sort(compareNewestFirst);',
  '  const activeFeedPosts = ["trending", "popular-today", "topics"].includes(feedMode) ? discoveryTimelinePosts() : allTimelinePosts();\n  const unexpiredPosts = visibleTimelinePosts(activeFeedPosts).sort(compareNewestFirst);\n  const suggestionPosts = visibleTimelinePosts(discoveryTimelinePosts()).sort(compareNewestFirst);',
  "render active-feed source"
);

replaceOnce(
  '    const viewerTopicSet = new Set(unexpiredPosts\n      .filter((post) => post.data().authorId === currentUser?.uid)',
  '    const viewerTopicSet = new Set(suggestionPosts\n      .filter((post) => post.data().authorId === currentUser?.uid)',
  "suggested follow viewer topic source"
);

replaceOnce(
  '    const publicInteractionCountForCandidate = (candidateUid) => unexpiredPosts.reduce((total, post) => {',
  '    const publicInteractionCountForCandidate = (candidateUid) => suggestionPosts.reduce((total, post) => {',
  "suggested follow interaction source"
);

replaceOnce(
  '      const candidateTopics = [...new Set(unexpiredPosts\n        .filter((post) => post.data().authorId === profile.id)',
  '      const candidateTopics = [...new Set(suggestionPosts\n        .filter((post) => post.data().authorId === profile.id)',
  "suggested follow candidate topic source"
);

const oldTrending = `    phaseBPosts = [...filteredPosts].filter((post) => trendingScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).filter((c) => !c.data().parentCommentId).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()) > -Infinity)\n      .sort((a, b) => trendingScore({ createdAtMs: b.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(b).length, commentCount: postComments(b).length, replyCount: postComments(b).filter((c) => c.data().parentCommentId).length }, Date.now()) - trendingScore({ createdAtMs: a.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(a).length, commentCount: postComments(a).length, replyCount: postComments(a).filter((c) => c.data().parentCommentId).length }, Date.now()));`;
const newTrending = `    const trendingPosts = [...filteredPosts].filter((post) => trendingScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).filter((c) => !c.data().parentCommentId).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()) > -Infinity);\n    phaseBPosts = sortScoredFeedPosts(trendingPosts, (post) => trendingScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()));`;
replaceOnce(oldTrending, newTrending, "trending scored ordering");

const oldPopular = `    phaseBPosts = [...filteredPosts].filter((post) => { const data = post.data(); const score = popularTodayScore({ createdAtMs: data.createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()); return score > -Infinity; })\n      .sort((a, b) => popularTodayScore({ createdAtMs: b.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(b).length, commentCount: postComments(b).length, replyCount: postComments(b).filter((c) => c.data().parentCommentId).length }, Date.now()) - popularTodayScore({ createdAtMs: a.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(a).length, commentCount: postComments(a).length, replyCount: postComments(a).filter((c) => c.data().parentCommentId).length }, Date.now()));`;
const newPopular = `    const popularPosts = [...filteredPosts].filter((post) => { const data = post.data(); const score = popularTodayScore({ createdAtMs: data.createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()); return score > -Infinity; });\n    phaseBPosts = sortScoredFeedPosts(popularPosts, (post) => popularTodayScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()));`;
replaceOnce(oldPopular, newPopular, "popular scored ordering");

source = source.replace(
  'query(collection(db, "posts"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), limit(DISCOVERY_POST_LIMIT)),\n    (snapshot) => {\n      syncReportedHolds("posts", snapshot.docs);\n      postDocs = snapshot.docs;',
  'query(collection(db, "posts"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), limit(TIMELINE_POST_LIMIT)),\n    (snapshot) => {\n      syncReportedHolds("posts", snapshot.docs);\n      postDocs = snapshot.docs;'
);
source = source.replace(
  'query(collection(db, "communityPosts"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), limit(DISCOVERY_POST_LIMIT)),\n    (snapshot) => {\n      syncReportedHolds("communityPosts", snapshot.docs);\n      communityPostDocs = snapshot.docs;',
  'query(collection(db, "communityPosts"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), limit(TIMELINE_POST_LIMIT)),\n    (snapshot) => {\n      syncReportedHolds("communityPosts", snapshot.docs);\n      communityPostDocs = snapshot.docs;'
);

if (!source.includes('limit(TIMELINE_POST_LIMIT)')) throw new Error("Canonical timeline query limit was not restored");

const discoveryListeners = `  listeners.push(listenForSession(\n    query(collection(db, "posts"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), limit(DISCOVERY_POST_LIMIT)),\n    (snapshot) => {\n      discoveryPostDocs = snapshot.docs;\n      if (["trending", "popular-today", "topics"].includes(feedMode)) syncInteractionListeners();\n      renderPosts();\n    },\n    () => setStatus("Could not load discovery posts.", true)\n  ));\n\n  listeners.push(listenForSession(\n    query(collection(db, "communityPosts"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), limit(DISCOVERY_POST_LIMIT)),\n    (snapshot) => {\n      discoveryCommunityPostDocs = snapshot.docs;\n      if (["trending", "popular-today", "topics"].includes(feedMode)) syncInteractionListeners();\n      renderPosts();\n    },\n    () => setStatus("Could not load discovery community posts.", true)\n  ));\n\n`;
const recentSearchAnchor = `  listeners.push(listenForSession(\n    query(collection(db, "users", user.uid, "recentSearches"), orderBy("searchedAt", "desc"), limit(20)),`;
if (!source.includes(discoveryListeners)) {
  if (!source.includes(recentSearchAnchor)) throw new Error("Could not locate discovery listener insertion anchor");
  source = source.replace(recentSearchAnchor, discoveryListeners + recentSearchAnchor);
}

replaceOnce(
  'const setFeedView = (mode) => {\n  feedMode = mode;',
  'const setFeedView = (mode) => {\n  feedMode = mode;\n  syncInteractionListeners();',
  "feed-mode interaction synchronization"
);

replaceOnce(
  '  communityPostDocs = [];',
  '  communityPostDocs = [];\n  discoveryPostDocs = [];\n  discoveryCommunityPostDocs = [];',
  "discovery state cleanup"
);

fs.writeFileSync(path, source);
console.log("Applied scored ordering and separate discovery query fix");
