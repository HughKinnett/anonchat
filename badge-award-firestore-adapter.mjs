import { ANONCHAT_BADGE_CATALOG } from "./badge-policy.mjs";

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
