import assert from "node:assert/strict";
import {
  planLegacyVoteMigration,
  runVoteSchemaBackfill
} from "../vote-schema-backfill-policy.mjs";

const legacy = { postId: "target", uid: "member", option: 1, createdAt: 10 };
assert.deepEqual(planLegacyVoteMigration({ id: "target_member", data: legacy }, {
  posts: true, communityPosts: false
}), {
  fromId: "target_member",
  toId: "posts_target_member",
  data: { ...legacy, postCollection: "posts" }
});
assert.deepEqual(planLegacyVoteMigration({ id: "target_member", data: legacy }, {
  posts: false, communityPosts: true
}), {
  fromId: "target_member",
  toId: "communityPosts_target_member",
  data: { ...legacy, postCollection: "communityPosts" }
});
assert.equal(planLegacyVoteMigration({ id: "target_member", data: legacy }, {
  posts: true, communityPosts: true
}), null, "same-ID targets are intentionally left ambiguous");
assert.equal(planLegacyVoteMigration({ id: "target_member", data: legacy }, {
  posts: false, communityPosts: false
}), null, "orphan legacy votes are not guessed");
assert.equal(planLegacyVoteMigration({ id: "already-new", data: { ...legacy, postCollection: "posts" } }, {
  posts: true, communityPosts: false
}), null);

const documents = [
  { id: "timeline_member", data: { ...legacy, postId: "timeline" } },
  { id: "community_member", data: { ...legacy, postId: "community" } },
  { id: "shared_member", data: { ...legacy, postId: "shared" } },
  { id: "new_member", data: { ...legacy, postId: "new", postCollection: "posts" } }
];
const commits = [];
const adapter = {
  async scan(afterId, limit) {
    const start = afterId == null ? 0 : documents.findIndex(document => document.id === afterId) + 1;
    const page = documents.slice(start, start + limit);
    return { documents: page, nextCursor: page.length === limit ? page.at(-1).id : null };
  },
  async targetPresence(postId) {
    return {
      posts: ["timeline", "shared", "new"].includes(postId),
      communityPosts: ["community", "shared"].includes(postId)
    };
  },
  async commit(migrations) { commits.push(migrations); }
};
assert.deepEqual(await runVoteSchemaBackfill({ adapter }), {
  mode: "dry-run", scanned: 4, eligible: 2, migrated: 0, ambiguous: 1, alreadyMigrated: 1, batches: 0
});
assert.equal(commits.length, 0);
assert.deepEqual(await runVoteSchemaBackfill({ adapter, apply: true }), {
  mode: "apply", scanned: 4, eligible: 2, migrated: 2, ambiguous: 1, alreadyMigrated: 1, batches: 1
});
assert.deepEqual(commits[0].map(entry => entry.toId), ["posts_timeline_member", "communityPosts_community_member"]);

console.log("Vote schema backfill policy passed");
