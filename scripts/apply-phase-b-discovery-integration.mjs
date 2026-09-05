import fs from "node:fs";

const path = "timeline.js";
let source = fs.readFileSync(path, "utf8");

const replaceOnce = (needle, replacement, label) => {
  if (!source.includes(needle)) throw new Error(`Could not locate ${label}`);
  source = source.replace(needle, () => replacement);
};

replaceOnce(
  `const TIMELINE_POST_LIMIT = 20;`,
  `const DISCOVERY_POST_LIMIT = 100;`,
  "timeline post limit"
);

source = source.replaceAll("limit(TIMELINE_POST_LIMIT)", "limit(DISCOVERY_POST_LIMIT)");

replaceOnce(
  `  feed.replaceChildren(...visiblePosts.map(renderPost));
  if (suggestedFollowsList) {
    const followedUidsForSuggestions = new Set(visibleFollows().filter((follow) => follow.data().followerId === currentUser?.uid).map((follow) => follow.data().followingId));
    const candidates = visibleUsers().map((profile) => ({ uid: profile.id, mutuals: visibleFollows().filter((f) => f.data().followingId === profile.id).length, sharedTopics: 0, publicInteractions: 0, username: profile.data().username }));
    const suggestions = suggestFollowCandidates(candidates, { viewerUid: currentUser?.uid, followedUids: followedUidsForSuggestions, blockedUids: new Set(viewerBlocks.blockedUids) }, 5);`,
  `  feed.replaceChildren(...visiblePosts.map(renderPost));
  if (suggestedFollowsList) {
    const followedUidsForSuggestions = new Set(visibleFollows().filter((follow) => follow.data().followerId === currentUser?.uid).map((follow) => follow.data().followingId));
    const viewerTopicSet = new Set(unexpiredPosts
      .filter((post) => post.data().authorId === currentUser?.uid)
      .flatMap((post) => postTopics(post.data())));
    const publicInteractionCountForCandidate = (candidateUid) => unexpiredPosts.reduce((total, post) => {
      const authorId = post.data().authorId;
      if (authorId !== candidateUid && authorId !== currentUser?.uid) return total;
      const counterpartUid = authorId === candidateUid ? currentUser?.uid : candidateUid;
      const reactionMatches = postReactions(post).filter((reaction) => reaction.data().uid === counterpartUid).length;
      const commentMatches = postComments(post).filter((comment) => comment.data().uid === counterpartUid).length;
      return total + reactionMatches + commentMatches;
    }, 0);
    const candidates = visibleUsers().map((profile) => {
      const candidateTopics = [...new Set(unexpiredPosts
        .filter((post) => post.data().authorId === profile.id)
        .flatMap((post) => postTopics(post.data())))];
      return {
        uid: profile.id,
        mutuals: 0,
        sharedTopics: candidateTopics.filter((topic) => viewerTopicSet.has(topic)).length,
        publicInteractions: publicInteractionCountForCandidate(profile.id),
        username: profile.data().username
      };
    });
    const suggestions = suggestFollowCandidates(candidates, { viewerUid: currentUser?.uid, followedUids: followedUidsForSuggestions, blockedUids: new Set(viewerBlocks.blockedUids) }, 5);`,
  "suggested follows integration"
);

fs.writeFileSync(path, source);
console.log("Applied complete Phase B discovery integration");
