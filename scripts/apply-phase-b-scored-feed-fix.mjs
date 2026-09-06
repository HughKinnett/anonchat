import fs from "node:fs";

// One-shot migration used to remove timeline-local score sorting.
const path = "timeline.js";
let source = fs.readFileSync(path, "utf8");

const oldImport = 'import { filterFeedPosts, sortFeedPosts } from "./feed-mode-policy.mjs";';
const newImport = 'import { filterFeedPosts, sortFeedPosts, sortScoredFeedPosts } from "./feed-mode-policy.mjs";';
if (!source.includes(oldImport) && !source.includes(newImport)) throw new Error("Could not locate feed policy import");
if (source.includes(oldImport)) source = source.replace(oldImport, newImport);

const oldTrending = `    phaseBPosts = [...filteredPosts].filter((post) => trendingScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).filter((c) => !c.data().parentCommentId).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()) > -Infinity)\n      .sort((a, b) => trendingScore({ createdAtMs: b.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(b).length, commentCount: postComments(b).length, replyCount: postComments(b).filter((c) => c.data().parentCommentId).length }, Date.now()) - trendingScore({ createdAtMs: a.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(a).length, commentCount: postComments(a).length, replyCount: postComments(a).filter((c) => c.data().parentCommentId).length }, Date.now()));`;
const newTrending = `    const trendingPosts = [...filteredPosts].filter((post) => trendingScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).filter((c) => !c.data().parentCommentId).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()) > -Infinity);\n    phaseBPosts = sortScoredFeedPosts(trendingPosts, (post) => trendingScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()));`;
if (!source.includes(oldTrending) && !source.includes(newTrending)) throw new Error("Could not locate trending inline sort");
if (source.includes(oldTrending)) source = source.replace(oldTrending, newTrending);

const oldPopular = `    phaseBPosts = [...filteredPosts].filter((post) => { const data = post.data(); const score = popularTodayScore({ createdAtMs: data.createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()); return score > -Infinity; })\n      .sort((a, b) => popularTodayScore({ createdAtMs: b.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(b).length, commentCount: postComments(b).length, replyCount: postComments(b).filter((c) => c.data().parentCommentId).length }, Date.now()) - popularTodayScore({ createdAtMs: a.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(a).length, commentCount: postComments(a).length, replyCount: postComments(a).filter((c) => c.data().parentCommentId).length }, Date.now()));`;
const newPopular = `    const popularPosts = [...filteredPosts].filter((post) => { const data = post.data(); const score = popularTodayScore({ createdAtMs: data.createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()); return score > -Infinity; });\n    phaseBPosts = sortScoredFeedPosts(popularPosts, (post) => popularTodayScore({ createdAtMs: post.data().createdAt?.toMillis?.() || 0, uniqueInteractions: postReactions(post).length, commentCount: postComments(post).length, replyCount: postComments(post).filter((c) => c.data().parentCommentId).length }, Date.now()));`;
if (!source.includes(oldPopular) && !source.includes(newPopular)) throw new Error("Could not locate popular inline sort");
if (source.includes(oldPopular)) source = source.replace(oldPopular, newPopular);

fs.writeFileSync(path, source);
console.log("Applied scored feed ordering policy fix");
