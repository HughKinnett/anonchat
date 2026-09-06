import assert from "node:assert/strict";
import { scoreFollowCandidate, suggestFollowCandidates } from "../suggested-follow-policy.mjs";

const now = Date.UTC(2026, 8, 6, 20, 0, 0);
const context = {
  viewerUid: "viewer",
  followedUids: new Set(["followed"]),
  blockedUids: new Set(["blocked"]),
  now
};

assert.ok(
  scoreFollowCandidate({ uid: "commented", viewerComments: 3, lastAffinityAtMs: now }, context)
  > scoreFollowCandidate({ uid: "reacted", viewerReactions: 3, lastAffinityAtMs: now }, context),
  "comments should carry more follow-affinity weight than reactions"
);
assert.ok(
  scoreFollowCandidate({ uid: "recent", viewerComments: 1, lastAffinityAtMs: now - 60_000 }, context)
  > scoreFollowCandidate({ uid: "old", viewerComments: 1, lastAffinityAtMs: now - 90 * 24 * 60 * 60 * 1000 }, context),
  "recent affinity should beat stale affinity"
);
assert.ok(
  scoreFollowCandidate({ uid: "capped", viewerComments: 999, viewerReactions: 999, mutuals: 999, lastAffinityAtMs: now }, context)
  < 500,
  "raw activity counts are bounded"
);

const ranked = suggestFollowCandidates([
  { uid: "viewer", mutuals: 99 },
  { uid: "followed", mutuals: 99 },
  { uid: "blocked", mutuals: 99 },
  { uid: "eligible", mutuals: 1, viewerComments: 1, lastAffinityAtMs: now }
], context, 10);
assert.deepEqual(ranked.map((entry) => entry.uid), ["eligible"], "self/followed/blocked users stay excluded");
assert.equal(suggestFollowCandidates(ranked, { viewerUid: "viewer" }, 1).length, 1, "candidate list stays bounded");

console.log("suggested follow behavioral policy contract passed");
