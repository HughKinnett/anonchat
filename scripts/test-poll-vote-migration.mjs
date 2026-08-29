import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestorePollVoteMigrator } from "../poll-vote-migration.mjs";
import { pollVoteDocumentId } from "../poll-vote-policy.mjs";

assert.equal(pollVoteDocumentId("posts", "same-id", "user-a"), "posts:same-id:user-a");
assert.equal(pollVoteDocumentId("communityPosts", "same-id", "user-a"), "communityPosts:same-id:user-a");
assert.throws(() => pollVoteDocumentId("rooms", "post", "user"), /INVALID_POLL_VOTE_ID/);

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator is required");
const app = initializeApp({ projectId: "poll-vote-migration-test" }, "poll-vote-migration-test");
const store = getFirestore(app);

try {
  const now = Timestamp.fromMillis(1_000);
  await Promise.all([
    store.doc("posts/timeline-only").set({ moderationState: "visible" }),
    store.doc("communityPosts/community-only").set({ moderationState: "visible" }),
    store.doc("posts/ambiguous").set({ moderationState: "visible" }),
    store.doc("communityPosts/ambiguous").set({ moderationState: "visible" }),
    store.doc("communityVotes/timeline-only_user-a").set({ postId: "timeline-only", uid: "user-a", option: 0, createdAt: now }),
    store.doc("communityVotes/community-only_user-a").set({ postId: "community-only", uid: "user-a", option: 1, createdAt: now }),
    store.doc("communityVotes/ambiguous_user-a").set({ postId: "ambiguous", uid: "user-a", option: 2, createdAt: now }),
    store.doc("communityVotes/orphan_user-a").set({ postId: "orphan", uid: "user-a", option: 3, createdAt: now })
  ]);

    const migrator = new FirestorePollVoteMigrator({ db: store, Timestamp, FieldPath, clock: () => 2_000 });
    assert.deepEqual(await migrator.run(), { migrated: 2, ambiguous: 1, orphaned: 1, conflicts: 0 });
    assert.equal((await store.doc("communityVotes/posts:timeline-only:user-a").get()).data().postCollection, "posts");
    assert.equal((await store.doc("communityVotes/communityPosts:community-only:user-a").get()).data().postCollection, "communityPosts");
    assert.equal((await store.doc("communityVotes/timeline-only_user-a").get()).exists, false);
    assert.equal((await store.doc("communityVotes/community-only_user-a").get()).exists, false);
    assert.equal((await store.doc("communityVotes/ambiguous_user-a").get()).exists, true,
      "same-ID cross-collection legacy votes remain quarantined instead of leaking to either poll");
    assert.equal((await store.doc("communityVotes/orphan_user-a").get()).exists, true);
    assert.equal((await store.doc("communityVotes/ambiguous_user-a").get()).data().legacyMigrationState, "ambiguous");
    assert.equal((await store.doc("communityVotes/orphan_user-a").get()).data().legacyMigrationState, "orphaned");
    const marker = (await store.doc("system/pollVoteSchemaMigration").get()).data();
    assert.equal(marker.schemaVersion, 1);
    await Promise.all([
      store.doc("posts/ambiguous").delete(),
      store.doc("communityPosts/orphan").set({ moderationState: "visible" }),
      store.doc("communityPosts/late-community").set({ moderationState: "visible" }),
      store.doc("communityVotes/late-community_user-b").set({ postId: "late-community", uid: "user-b", option: 1, createdAt: now })
    ]);
    assert.deepEqual(await migrator.run(), { migrated: 1, ambiguous: 1, orphaned: 1, conflicts: 0 },
      "a second post-rules drain migrates legacy votes created during the rules cutover window");
    assert.equal((await store.doc("communityVotes/communityPosts:late-community:user-b").get()).exists, true);
    assert.equal((await store.doc("communityVotes/ambiguous_user-a").get()).data().legacyMigrationState, "ambiguous",
      "an ambiguous vote is never reinterpreted after one same-ID parent is deleted");
    assert.equal((await store.doc("communityVotes/orphan_user-a").get()).data().legacyMigrationState, "orphaned",
      "an orphaned vote is never reinterpreted if a same-ID parent is later recreated");
    assert.deepEqual(await migrator.run(), { migrated: 0, ambiguous: 1, orphaned: 1, conflicts: 0 },
      "a completed migration remains idempotent while still auditing quarantined and cutover records");
    await Promise.all([
      store.doc("communityPosts/conflict").set({ moderationState: "visible" }),
      store.doc("communityPosts/conflict-neighbor").set({ moderationState: "visible" }),
      store.doc("communityVotes/conflict_user-c").set({ postId: "conflict", uid: "user-c", option: 1, createdAt: now }),
      store.doc("communityVotes/conflict-neighbor_user-c").set({ postId: "conflict-neighbor", uid: "user-c", option: 1, createdAt: now }),
      store.doc("communityVotes/communityPosts:conflict:user-c").set({
        postCollection: "communityPosts", postId: "conflict", uid: "user-c", option: 2, createdAt: now
      })
    ]);
    await assert.rejects(() => migrator.run(), (error) => error.code === "POLL_VOTE_MIGRATION_CONFLICT",
      "a conflicting canonical vote fails the privileged drain closed");
    assert.equal((await store.doc("communityVotes/conflict_user-c").get()).exists, true,
      "the conflicting legacy source remains available for administrator review");
    assert.equal((await store.doc("communityVotes/conflict-neighbor_user-c").get()).exists, true,
      "the bounded migration page stays unchanged when any target conflicts");
    assert.equal((await store.doc("communityVotes/communityPosts:conflict:user-c").get()).data().option, 2,
      "the conflicting canonical target is never overwritten");
} finally {
  await deleteApp(app);
}

console.log("Poll vote migration passed");
