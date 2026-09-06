import assert from "node:assert/strict";
import { reconcileActivityBadges } from "../badge-activity-reconciliation.mjs";

const users = [
  { id: "u1" },
  { id: "u2" }
];
const calls = [];
const awards = [];
const adapter = {
  db: {},
  async listUsersPage({ limit, cursor }) {
    calls.push(["listUsersPage", limit, cursor]);
    return cursor ? { users: [], nextCursor: null } : { users, nextCursor: null };
  },
  async listEarnedBadgeIds(uid) {
    calls.push(["listEarnedBadgeIds", uid]);
    return uid === "u1" ? new Set(["top-contributor"]) : new Set();
  },
  async countPostsCreated(uid) {
    calls.push(["countPostsCreated", uid]);
    return uid === "u2" ? 100 : 0;
  },
  async countCommentsOrRepliesCreated(uid) {
    calls.push(["countCommentsOrRepliesCreated", uid]);
    return uid === "u1" ? 100 : 12;
  },
  async maxPostInteractions(uid, threshold) {
    calls.push(["maxPostInteractions", uid, threshold]);
    return uid === "u2" ? 100 : 5;
  },
  async featureEnabled() { return true; },
  async listActiveDefinitions() {
    return [
      { id: "top-contributor", awardMode: "automatic", active: true, milestoneMetric: "posts_created", milestoneThreshold: 100 },
      { id: "community-helper", awardMode: "automatic", active: true, milestoneMetric: "comments_or_replies_created", milestoneThreshold: 100 },
      { id: "popular-post-creator", awardMode: "automatic", active: true, milestoneMetric: "single_post_interactions", milestoneThreshold: 100 }
    ];
  },
  async awardIfMissing(uid, badgeId) {
    awards.push([uid, badgeId]);
    return { awarded: true, badgeId };
  }
};

const result = await reconcileActivityBadges({ adapter, batchSize: 25, maxBatches: 2 });
assert.equal(result.inspected, 2);
assert.equal(result.evaluated, 2);
assert.deepEqual(awards.sort(), [
  ["u1", "community-helper"],
  ["u2", "popular-post-creator"],
  ["u2", "top-contributor"]
].sort());
assert.equal(calls.some(([name, uid]) => name === "countPostsCreated" && uid === "u1"), false,
  "already-earned Top Contributor skips its post-count query");
assert.equal(calls.some(([name, uid]) => name === "countCommentsOrRepliesCreated" && uid === "u1"), true);
assert.equal(calls.some(([name, uid]) => name === "maxPostInteractions" && uid === "u2"), true);
assert.deepEqual(calls.find(([name]) => name === "listUsersPage"), ["listUsersPage", 25, null],
  "activity reconciliation uses a bounded user page");

console.log("Automatic activity badge reconciliation contract passed");
