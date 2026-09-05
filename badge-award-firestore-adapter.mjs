export class FirestoreBadgeAwardAdapter {
  constructor({ db, FieldValue }) {
    if (!db || !FieldValue) throw new Error("Firestore database and FieldValue are required.");
    this.db = db;
    this.FieldValue = FieldValue;
  }

  async listActiveDefinitions() {
    const snapshot = await this.db.collection("badgeTypes").where("active", "==", true).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
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
        assignedAt: timestamp,
        assignedBy: "system",
        awardSource: "automatic",
        featured: false
      });
      return { awarded: true, badgeId };
    });
  }
}
