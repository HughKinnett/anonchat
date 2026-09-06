import fs from "node:fs";

const path = "timeline.js";
let source = fs.readFileSync(path, "utf8");
const needle = `    const followedUidsForSuggestions = new Set(visibleFollows().filter((follow) => follow.data().followerId === currentUser?.uid).map((follow) => follow.data().followingId));
    const viewerTopicSet = new Set(unexpiredPosts`;
const replacement = `    const followedUidsForSuggestions = new Set(visibleFollows().filter((follow) => follow.data().followerId === currentUser?.uid).map((follow) => follow.data().followingId));
    const viewerFollowingSet = new Set(followedUidsForSuggestions);
    const viewerTopicSet = new Set(unexpiredPosts`;
if (!source.includes(needle)) throw new Error("Could not locate suggested-follow setup");
source = source.replace(needle, () => replacement);

const mutualNeedle = `        uid: profile.id,
        mutuals: 0,
        sharedTopics: candidateTopics.filter((topic) => viewerTopicSet.has(topic)).length,`;
const mutualReplacement = `        uid: profile.id,
        mutuals: visibleFollows().filter((follow) => follow.data().followingId === profile.id && viewerFollowingSet.has(follow.data().followerId)).length,
        sharedTopics: candidateTopics.filter((topic) => viewerTopicSet.has(topic)).length,`;
if (!source.includes(mutualNeedle)) throw new Error("Could not locate placeholder mutual score");
source = source.replace(mutualNeedle, () => mutualReplacement);

fs.writeFileSync(path, source);
console.log("Applied real mutual-follow suggestion scoring");
