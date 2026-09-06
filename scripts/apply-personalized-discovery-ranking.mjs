import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const write = (path, text) => fs.writeFileSync(path, text);
const replaceOnce = (text, pattern, replacement, label) => {
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`Patch target not found: ${label}`);
  return next;
};

let html = read("timeline.html");
html = replaceOnce(html, /\n\s*<button id="show-popular-today-posts"[^\n]*<\/button>/, "", "Popular Today button");
html = replaceOnce(html, /\n\s*<button id="show-history-posts"[^\n]*<\/button>/, "", "History button");
html = replaceOnce(html, /\n\s*<section id="recent-searches"[^\n]*<\/section>/, "", "Recent Searches panel");
write("timeline.html", html);

let timeline = read("timeline.js");
timeline = replaceOnce(
  timeline,
  'import { applicationDayBounds, popularTodayScore, trendingScore } from "./hashtag-discovery-policy.mjs";',
  'import { trendingScore } from "./hashtag-discovery-policy.mjs";',
  "Trending import"
);
if (!timeline.includes('from "./feed-ranking-policy.mjs"')) {
  timeline = replaceOnce(
    timeline,
    'import { filterFeedPosts, sortFeedPosts, sortScoredFeedPosts } from "./feed-mode-policy.mjs";',
    'import { filterFeedPosts, sortFeedPosts, sortScoredFeedPosts } from "./feed-mode-policy.mjs";\nimport { blendRecommendedPosts, rankFeedPosts } from "./feed-ranking-policy.mjs";',
    "feed ranking import"
  );
}
timeline = timeline
  .replace(/\nconst popularTodayPostsButton = document\.getElementById\("show-popular-today-posts"\);/, "")
  .replace(/\nconst historyPostsButton = document\.getElementById\("show-history-posts"\);/, "")
  .replaceAll('["trending", "popular-today", "topics"]', '["trending", "topics"]');

timeline = replaceOnce(
  timeline,
  /\n\s*} else if \(feedMode === "popular-today"\) \{[\s\S]*?\n\s*} else if \(feedMode === "saved-posts"\)/,
  '\n  } else if (feedMode === "saved-posts")',
  "Popular Today render branch"
);
timeline = timeline.replace(/\n\s*else if \(feedMode === "history"\)[^\n]*/, "");
timeline = timeline.replace('["trending", "popular-today", "saved-posts", "history"]', '["trending", "saved-posts"]');
timeline = timeline
  .replace(/\n\s*popularTodayPostsButton\?\.setAttribute\([^\n]*/, "")
  .replace(/\n\s*historyPostsButton\?\.setAttribute\([^\n]*/, "")
  .replace(/\n\s*popularTodayPostsButton\?\.addEventListener\([^\n]*/, "")
  .replace(/\n\s*historyPostsButton\?\.addEventListener\([^\n]*/, "")
  .replace(', "popular-today": "Popular Today"', "")
  .replace(', history: "Viewed history"', "");

const mapAnchor = '  const followedUids = new Set(visibleFollows().filter(follow => follow.data().followerId === currentUser?.uid).map(follow => follow.data().followingId));\n';
const mapReplacement = `${mapAnchor}  const rankingPosts = [...new Map([...unexpiredPosts, ...suggestionPosts].map((post) => [post.ref.path, post])).values()];\n  const rankingReactionCounts = new Map(rankingPosts.map((post) => [post.ref.path, postReactions(post).length]));\n  const rankingCommentCounts = new Map(rankingPosts.map((post) => [post.ref.path, postComments(post).length]));\n  const authorAffinity = new Map();\n  const lastAffinityByAuthor = new Map();\n  for (const post of suggestionPosts) {\n    const authorId = post.data().type === "repost" ? post.data().originalAuthorId : post.data().authorId;\n    if (!authorId || authorId === currentUser?.uid) continue;\n    const viewerReactions = postReactions(post).filter((reaction) => reaction.data().uid === currentUser?.uid);\n    const viewerComments = postComments(post).filter((comment) => comment.data().uid === currentUser?.uid);\n    const affinity = viewerComments.length * 1.5 + viewerReactions.length;\n    if (affinity > 0) authorAffinity.set(authorId, Math.min(6, (authorAffinity.get(authorId) || 0) + affinity));\n    for (const signal of [...viewerReactions, ...viewerComments]) {\n      const signalMs = signal.data().createdAt?.toMillis?.() || signal.data().updatedAt?.toMillis?.() || 0;\n      if (signalMs > (lastAffinityByAuthor.get(authorId) || 0)) lastAffinityByAuthor.set(authorId, signalMs);\n    }\n  }\n  const similarAuthorAffinity = new Map();\n  for (const post of suggestionPosts) {\n    const authorId = post.data().type === "repost" ? post.data().originalAuthorId : post.data().authorId;\n    if (!authorId || followedUids.has(authorId) || authorId === currentUser?.uid || similarAuthorAffinity.has(authorId)) continue;\n    const mutualSocial = visibleFollows().filter((follow) => follow.data().followingId === authorId && followedUids.has(follow.data().followerId)).length;\n    if (mutualSocial) similarAuthorAffinity.set(authorId, Math.min(3, mutualSocial));\n  }\n`;
timeline = replaceOnce(timeline, mapAnchor, mapReplacement, "behavioral affinity maps");

const candidateAnchor = '        sharedTopics: candidateTopics.filter((topic) => viewerTopicSet.has(topic)).length,\n        publicInteractions: publicInteractionCountForCandidate(profile.id),\n        username: profile.data().username';
const candidateReplacement = '        sharedTopics: candidateTopics.filter((topic) => viewerTopicSet.has(topic)).length,\n        viewerComments: suggestionPosts.filter((post) => post.data().authorId === profile.id).reduce((total, post) => total + postComments(post).filter((comment) => comment.data().uid === currentUser?.uid).length, 0),\n        viewerReactions: suggestionPosts.filter((post) => post.data().authorId === profile.id).reduce((total, post) => total + postReactions(post).filter((reaction) => reaction.data().uid === currentUser?.uid).length, 0),\n        sharedInteractions: publicInteractionCountForCandidate(profile.id),\n        lastAffinityAtMs: lastAffinityByAuthor.get(profile.id) || 0,\n        username: profile.data().username';
timeline = replaceOnce(timeline, candidateAnchor, candidateReplacement, "suggested follow behavioral fields");
timeline = timeline.replace(
  'const suggestions = suggestFollowCandidates(candidates, { viewerUid: currentUser?.uid, followedUids: followedUidsForSuggestions, blockedUids: new Set(viewerBlocks.blockedUids) }, 5);',
  'const suggestions = suggestFollowCandidates(candidates, { viewerUid: currentUser?.uid, followedUids: followedUidsForSuggestions, blockedUids: new Set(viewerBlocks.blockedUids), now: Date.now() }, 5);'
);

const visibleAnchor = `  const visiblePosts = showingProfile\n    ? orderedPosts.filter((post) => post.data().authorId === currentUser.uid)\n    : orderedPosts;`;
const visibleReplacement = `  let visiblePosts = showingProfile\n    ? orderedPosts.filter((post) => post.data().authorId === currentUser.uid)\n    : orderedPosts;\n  if (!showingProfile && feedMode === "for-you") {\n    const rankingContext = {\n      viewerUid: currentUser?.uid,\n      followedUids,\n      reactionCounts: rankingReactionCounts,\n      commentCounts: rankingCommentCounts,\n      authorAffinity,\n      similarAuthorAffinity,\n      now: Date.now()\n    };\n    const normalPosts = rankFeedPosts(phaseBPosts.filter((post) => {\n      const data = post.data();\n      const authorId = data.type === "repost" ? data.originalAuthorId : data.authorId;\n      return authorId === currentUser?.uid || followedUids.has(authorId);\n    }), rankingContext);\n    const normalPaths = new Set(normalPosts.map((post) => post.ref.path));\n    const recommendedCandidates = suggestionPosts.filter((post) => {\n      const data = post.data();\n      const authorId = data.type === "repost" ? data.originalAuthorId : data.authorId;\n      return authorId && authorId !== currentUser?.uid && !followedUids.has(authorId) && !normalPaths.has(post.ref.path);\n    });\n    const recommendedPosts = rankFeedPosts(recommendedCandidates, rankingContext);\n    visiblePosts = normalPosts.length >= 5\n      ? blendRecommendedPosts(normalPosts, recommendedPosts, { interval: 5 }).slice(0, TIMELINE_POST_LIMIT)\n      : rankFeedPosts([...normalPosts, ...recommendedPosts], rankingContext).slice(0, TIMELINE_POST_LIMIT);\n  }`;
timeline = replaceOnce(timeline, visibleAnchor, visibleReplacement, "For You recommendation blend");

if (timeline.includes("popular-today") || timeline.includes("popularTodayScore")) throw new Error("Popular Today logic remains in timeline.js");
write("timeline.js", timeline);

console.log("Personalized discovery timeline/UI patch applied.");
