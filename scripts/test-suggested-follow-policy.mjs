import assert from "node:assert/strict";
import { scoreFollowCandidate, suggestFollowCandidates } from "../suggested-follow-policy.mjs";

const candidates = [
  { uid: "self", mutuals: 99 },
  { uid: "followed", mutuals: 10 },
  { uid: "blocked", mutuals: 10 },
  { uid: "good", mutuals: 2, sharedTopics: 3, publicInteractions: 1 },
  { uid: "other", mutuals: 1, sharedTopics: 1, publicInteractions: 0 }
];
const result = suggestFollowCandidates(candidates, {
  viewerUid: "self",
  followedUids: new Set(["followed"]),
  blockedUids: new Set(["blocked"])
});
assert.deepEqual(result.map((item) => item.uid), ["good", "other"], "self/followed/blocked users are excluded and strongest candidates rank first");
assert.equal(scoreFollowCandidate({ mutuals: 2, sharedTopics: 3, publicInteractions: 1 }), 15);
assert.equal(suggestFollowCandidates(candidates, { viewerUid: "self" }, 1).length, 1, "candidate list is bounded");

console.log("suggested follow policy contract passed");
