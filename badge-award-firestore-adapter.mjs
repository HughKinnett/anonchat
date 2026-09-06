import { ANONCHAT_BADGE_CATALOG } from "./badge-policy.mjs";

const aggregateCount = (snapshot) => Number(snapshot?.data?.()?.count ?? 0);

export class FirestoreBadgeAwardAdapter {
  constructor({ db, FieldValue }) {
    if (!db || !FieldValue) throw new Error("Firestore database and FieldValue are required.");
    this.db = db;
    this.FieldValue = FieldValue;
  }

  async featureEnabled(key, fallback = true) {
    if (!key) return fallback;
    const snapshot = await this.db.collection("siteSettings").doc("features").get();
    if (!snapshot.exists) return fallback;
    const value = snapshot.data()?.[key];
    return typeof value === "boolean" ? value : fallback;
  }

  async listActiveDefinitions() {
    return ANONCHAT_BADGE_CATALOG.map((badge) => ({ ...badge, awardMode: "automatic", active: true }));
  }

  assignmentRef(uid, badgeId) {
    return this.db.collection("users").doc(uid).collection("badges").doc(badgeId);
  }

  async listUsersPage({ limit = 25, cursor = null } = {}) {
    let query = this.db.collection("users").orderBy("__name__").limit(limit);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const users = snapshot.docs.map((document) => ({ id: document.id }));
    const nextCursor = snapshot.size === limit ? snapshot.docs.at(-1)?.id ?? null : null;
    return { users, nextCursor };
  }

  async listEarnedBadgeIds(uid) {
    const snapshot = await this.db.collection("users").doc(uid).collection("badges").select().get();
    return new Set(snapshot.docs.map((document) => document.id));
  }

  async countPostsCreated(uid) {
    const snapshot = await this.db.collection("posts").where("authorId", "==", uid).count().get();
    return aggregateCount(snapshot);
  }

  async countCommentsOrRepliesCreated(uid) {
    const snapshot = await this.db.collectionGroup("comments").where("uid", "==", uid).count().get();
    return aggregateCount(snapshot);
  }

  async maxPostInteractions(uid, threshold = 100) {
    const posts = await this.db.collection("posts").where("authorId", "==", uid).select().get();
    let maximum = 0;
    for (const post of posts.docs) {
      const [comments, reactions] = await Promise.all([
        post.ref.collection("comments").count().get(),
        post.ref.collection("reactions").count().get()
      ]);
      const interactions = aggregateCount(comments) + aggregateCount(reactions);
      maximum = Math.max(maximum, interactions);
      if (maximum >= threshold) break;
    }
    return maximum;
  }

  async awardIfMissing(uid, badgeId) {
    if (!uid || !badgeId) throw new Error("User and badge are required.");
    const reference = this.assignmentRef(uid, badgeId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) return { awarded: false, reason: "already-earned" };
      const timestamp = this.FieldValue.serverTimestamp();
      transaction.create(reference, {
        badgeId,
        earnedAt: timestamp,
        awardSource: "automatic",
        featured: false
      });
      return { awarded: true, badgeId };
    });
  }

  async removeStatusBadge(uid, badgeId) {
    if (!uid || !badgeId) throw new Error("User and badge are required.");
    await this.assignmentRef(uid, badgeId).delete();
    return { removed: true, badgeId };
  }
}
