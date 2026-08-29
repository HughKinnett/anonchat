import { canonicalPollVote, POLL_VOTE_SCHEMA_VERSION, pollVoteDocumentId } from "./poll-vote-policy.mjs";

const PAGE_SIZE = 100;
const MARKER_PATH = "system/pollVoteSchemaMigration";
const emptyResult = () => ({ migrated: 0, ambiguous: 0, orphaned: 0, conflicts: 0 });
const sameVote = (left, right) => left?.postCollection === right.postCollection
  && left?.postId === right.postId && left?.uid === right.uid
  && left?.option === right.option;

export class FirestorePollVoteMigrator {
  constructor({ db, Timestamp, FieldPath, clock = () => Date.now() }) {
    this.db = db;
    this.Timestamp = Timestamp;
    this.FieldPath = FieldPath;
    this.clock = clock;
  }

  async run() {
    const markerRef = this.db.doc(MARKER_PATH);
    const result = emptyResult();
    let cursor;
    while (true) {
      let query = this.db.collection("communityVotes").orderBy(this.FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      const legacyRefs = page.docs.filter((entry) => !Object.hasOwn(entry.data(), "postCollection")).map((entry) => entry.ref);
      if (legacyRefs.length) {
        const outcome = await this.db.runTransaction(async (transaction) => {
          const legacy = await transaction.getAll(...legacyRefs);
          const validLegacy = legacy.filter((entry) => entry.exists && !Object.hasOwn(entry.data(), "postCollection"));
          const postRefs = validLegacy.map((entry) => this.db.collection("posts").doc(entry.data().postId));
          const communityRefs = validLegacy.map((entry) => this.db.collection("communityPosts").doc(entry.data().postId));
          const [posts, communityPosts] = await Promise.all([
            postRefs.length ? transaction.getAll(...postRefs) : [],
            communityRefs.length ? transaction.getAll(...communityRefs) : []
          ]);
          const changes = [];
          const quarantines = [];
          const counts = emptyResult();
          for (const [index, legacyVote] of validLegacy.entries()) {
            const data = legacyVote.data();
            if (data.legacyMigrationState === "ambiguous") { counts.ambiguous += 1; continue; }
            if (data.legacyMigrationState === "orphaned") { counts.orphaned += 1; continue; }
            const matches = [posts[index]?.exists ? "posts" : "", communityPosts[index]?.exists ? "communityPosts" : ""].filter(Boolean);
            if (matches.length > 1) {
              counts.ambiguous += 1;
              quarantines.push({ reference: legacyVote.ref, state: "ambiguous" });
              continue;
            }
            if (matches.length === 0) {
              counts.orphaned += 1;
              quarantines.push({ reference: legacyVote.ref, state: "orphaned" });
              continue;
            }
            let canonical;
            try { canonical = canonicalPollVote({ ...data, postCollection: matches[0] }); }
            catch {
              counts.orphaned += 1;
              quarantines.push({ reference: legacyVote.ref, state: "orphaned" });
              continue;
            }
            const targetRef = this.db.collection("communityVotes").doc(
              pollVoteDocumentId(canonical.postCollection, canonical.postId, canonical.uid)
            );
            changes.push({ legacyRef: legacyVote.ref, targetRef, canonical });
          }
          const targets = changes.length ? await transaction.getAll(...changes.map((change) => change.targetRef)) : [];
          counts.conflicts = changes.filter((change, index) =>
            targets[index].exists && !sameVote(targets[index].data(), change.canonical)
          ).length;
          if (counts.conflicts) return counts;
          quarantines.forEach(({ reference, state }) => {
            transaction.set(reference, { legacyMigrationState: state }, { merge: true });
          });
          changes.forEach((change, index) => {
            if (!targets[index].exists) transaction.create(change.targetRef, change.canonical);
            transaction.delete(change.legacyRef);
            counts.migrated += 1;
          });
          return counts;
        });
        for (const key of Object.keys(result)) result[key] += outcome[key];
        if (outcome.conflicts) throw Object.assign(new Error("POLL_VOTE_MIGRATION_CONFLICT"), { code: "POLL_VOTE_MIGRATION_CONFLICT" });
      }
      cursor = page.docs.at(-1).id;
    }
    await markerRef.set({
      status: "completed",
      schemaVersion: POLL_VOTE_SCHEMA_VERSION,
      ...result,
      completedAt: this.Timestamp.fromMillis(this.clock())
    });
    return result;
  }
}
