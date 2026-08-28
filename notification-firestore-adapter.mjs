import {
  ACCOUNT_LIMIT,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_PAGE_LIMIT,
  compareSourceCursors,
  isValidQueueEvent,
  timestampMillis
} from "./notification-policy.mjs";

const PROCESSOR_PATH = "system/notificationProcessor";
const SOURCE_COLLECTIONS = Object.freeze({
  reaction: { collection: "reactions", group: true },
  comment: { collection: "comments", group: true },
  "message-request": { collection: "messageRequests" },
  "room-message": { collection: "roomMessages" },
  "reveal-request": { collection: "reveals" }
});
const codedError = (code) => Object.assign(new Error(code), { code });
const sameSubscription = (left, right) => left?.uid === right?.uid
  && left?.endpoint === right?.endpoint
  && left?.p256dh === right?.p256dh
  && left?.auth === right?.auth;

export class FirestoreNotificationAdapter {
  constructor({ db, Timestamp, FieldPath, FieldValue, clock = () => Date.now(), tokenFactory }) {
    this.db = db;
    this.Timestamp = Timestamp;
    this.FieldPath = FieldPath;
    this.FieldValue = FieldValue;
    this.clock = clock;
    this.tokenFactory = tokenFactory ?? (() => crypto.randomUUID());
  }
  now() { return this.clock(); }
  timestamp(milliseconds) { return this.Timestamp.fromMillis(milliseconds); }
  stateRef() { return this.db.doc(PROCESSOR_PATH); }
  eventRef(eventId) { return this.db.collection("notificationEvents").doc(eventId); }

  async bootstrapSourceCursors(types) {
    const prepared = await this.db.runTransaction(async (transaction) => {
      const reference = this.stateRef();
      const snapshot = await transaction.get(reference);
      const existing = snapshot.exists ? snapshot.data().cursors : undefined;
      if (existing && types.every((type) => existing[type])) return { complete: true };
      const bootstrapAt = snapshot.exists ? snapshot.data().bootstrapAt : undefined;
      if (Number.isFinite(timestampMillis(bootstrapAt))) return { bootstrapAt };
      transaction.set(reference, {
        bootstrapAt: this.FieldValue.serverTimestamp(),
        status: "bootstrapping",
        updatedAt: this.FieldValue.serverTimestamp()
      }, { merge: true });
      return { readServerTime: true };
    });
    if (prepared.complete) return false;
    const bootstrapAt = prepared.bootstrapAt ?? (await this.stateRef().get()).data()?.bootstrapAt;
    if (!Number.isFinite(timestampMillis(bootstrapAt))) throw codedError("bootstrap-time-missing");
    return this.db.runTransaction(async (transaction) => {
      const reference = this.stateRef();
      const snapshot = await transaction.get(reference);
      const existing = snapshot.exists ? snapshot.data().cursors : undefined;
      if (existing && types.every((type) => existing[type])) return false;
      const cursors = Object.fromEntries(types.map((type) => [type, { createdAt: bootstrapAt, path: "\uf8ff" }]));
      transaction.set(reference, {
        cursors,
        bootstrapAt: this.FieldValue.delete(),
        status: "bootstrapped",
        updatedAt: this.FieldValue.serverTimestamp()
      }, { merge: true });
      return true;
    });
  }

  async storedCursor(type) {
    const snapshot = await this.stateRef().get();
    return snapshot.exists ? snapshot.data().cursors?.[type] : undefined;
  }

  async scanSourcePage(type, suppliedCursor) {
    const descriptor = SOURCE_COLLECTIONS[type];
    if (!descriptor) throw codedError("invalid-source-type");
    const cursor = suppliedCursor ?? await this.storedCursor(type);
    const base = descriptor.group
      ? this.db.collectionGroup(descriptor.collection)
      : this.db.collection(descriptor.collection);
    let query = base.orderBy("createdAt").orderBy(this.FieldPath.documentId()).limit(NOTIFICATION_PAGE_LIMIT);
    if (cursor) {
      query = cursor.path === "\uf8ff"
        ? query.startAfter(cursor.createdAt)
        : query.startAfter(cursor.createdAt, this.db.doc(cursor.path));
    }
    const snapshot = await query.get();
    const items = snapshot.docs.map((document) => ({ path: document.ref.path, data: document.data() }));
    const last = items.at(-1);
    return { items, nextCursor: last ? { createdAt: last.data.createdAt, path: last.path } : undefined };
  }

  async advanceSourceCursor(type, cursor) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.stateRef();
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("cursor-state-missing");
      const current = snapshot.data().cursors?.[type];
      if (current && compareSourceCursors(cursor, current) <= 0) return;
      transaction.update(reference, `cursors.${type}`, cursor);
    });
  }

  async postAuthor(source) {
    const segments = String(source?.path ?? "").split("/");
    if (segments.length < 4) return undefined;
    const snapshot = await this.db.doc(segments.slice(0, -2).join("/")).get();
    if (!snapshot.exists) return undefined;
    const data = snapshot.data();
    return data.type === "repost" ? data.originalAuthorId : data.authorId;
  }

  async roomMembers(source) {
    const snapshot = await this.db.collection("roomMembers")
      .where("roomId", "==", source?.data?.roomId)
      .orderBy(this.FieldPath.documentId())
      .limit(ACCOUNT_LIMIT)
      .get();
    return snapshot.docs.map((document) => document.data().uid);
  }

  async recipientAvailable(uid) {
    const [profile, adminDeletion, selfDeletion] = await Promise.all([
      this.db.collection("users").doc(uid).get(),
      this.db.collection("adminDeletionJobs").doc(uid).get(),
      this.db.collection("accountDeletionRequests").doc(uid).get()
    ]);
    return profile.exists && profile.data().banned !== true && !adminDeletion.exists && !selfDeletion.exists;
  }

  async createEvent(eventId, data) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.eventRef(eventId);
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) return false;
      transaction.create(reference, data);
      return true;
    });
  }

  async scanEventPage(cursor) {
    let query = this.db.collection("notificationEvents")
      .where("status", "in", ["pending", "failed", "processing"])
      .orderBy(this.FieldPath.documentId())
      .limit(NOTIFICATION_PAGE_LIMIT);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    return {
      items: snapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
      nextCursor: snapshot.docs.at(-1)?.id
    };
  }

  claimable(event) {
    return event?.status === "pending" || event?.status === "failed" || (
      event?.status === "processing"
      && Number.isFinite(timestampMillis(event.leaseExpiresAt))
      && timestampMillis(event.leaseExpiresAt) <= this.now()
    );
  }

  assertLease(event, token) {
    if (event?.status !== "processing" || event.leaseToken !== token
      || timestampMillis(event.leaseExpiresAt) <= this.now()) throw codedError("lease-lost");
  }

  async claimEvent(eventId, ownerId) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.eventRef(eventId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || !this.claimable(snapshot.data())) return null;
      const event = snapshot.data();
      if (!isValidQueueEvent(event)) throw codedError("invalid-event");
      const leaseToken = this.tokenFactory();
      const claimed = {
        type: event.type,
        actorUid: event.actorUid,
        recipientUid: event.recipientUid,
        route: event.route,
        sourceCreatedAt: event.sourceCreatedAt,
        status: "processing",
        attempts: event.attempts + 1,
        createdAt: event.createdAt,
        updatedAt: this.timestamp(this.now()),
        leaseOwner: ownerId,
        leaseToken,
        leaseExpiresAt: this.timestamp(this.now() + NOTIFICATION_LEASE_MS)
      };
      transaction.set(reference, claimed);
      return { id: eventId, token: leaseToken, data: claimed };
    });
  }

  async renewEvent(eventId, token) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.eventRef(eventId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLease(snapshot.data(), token);
      transaction.update(reference, {
        updatedAt: this.timestamp(this.now()),
        leaseExpiresAt: this.timestamp(this.now() + NOTIFICATION_LEASE_MS)
      });
    });
  }

  async listSubscriptions(recipientUid) {
    const snapshot = await this.db.collection("pushSubscriptions").where("uid", "==", recipientUid).get();
    return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  }

  async getDelivery(deliveryId) {
    const snapshot = await this.db.collection("notificationDeliveries").doc(deliveryId).get();
    return snapshot.exists ? snapshot.data() : undefined;
  }

  async markDelivery(deliveryId, data) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.db.collection("notificationDeliveries").doc(deliveryId);
      const snapshot = await transaction.get(reference);
      if (snapshot.exists) return false;
      transaction.create(reference, data);
      return true;
    });
  }

  async deleteExpiredSubscription(subscription) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.db.collection("pushSubscriptions").doc(subscription.id);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || !sameSubscription(snapshot.data(), subscription)) return false;
      transaction.delete(reference);
      return true;
    });
  }

  settledEvent(event, status, updatedAt, errorCode) {
    const settled = {
      type: event.type,
      actorUid: event.actorUid,
      recipientUid: event.recipientUid,
      route: event.route,
      sourceCreatedAt: event.sourceCreatedAt,
      status,
      attempts: event.attempts,
      createdAt: event.createdAt,
      updatedAt
    };
    if (errorCode) settled.errorCode = errorCode;
    return settled;
  }

  async completeEvent(eventId, token) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.eventRef(eventId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLease(snapshot.data(), token);
      transaction.set(reference, this.settledEvent(snapshot.data(), "delivered", this.timestamp(this.now())));
    });
  }

  async failEvent(eventId, token, errorCode) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.eventRef(eventId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLease(snapshot.data(), token);
      transaction.set(reference, this.settledEvent(snapshot.data(), "failed", this.timestamp(this.now()), errorCode));
    });
  }

  async purgeEventDeliveries(eventId) {
    let deleted = 0;
    while (true) {
      const snapshot = await this.db.collection("notificationDeliveries")
        .where("eventId", "==", eventId)
        .limit(NOTIFICATION_PAGE_LIMIT)
        .get();
      if (snapshot.empty) return deleted;
      const batch = this.db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      deleted += snapshot.size;
    }
  }

  async purgeDeliveredBefore(cutoff) {
    let deleted = 0;
    while (true) {
      const snapshot = await this.db.collection("notificationEvents")
        .where("status", "==", "delivered")
        .where("updatedAt", "<=", cutoff)
        .limit(NOTIFICATION_PAGE_LIMIT)
        .get();
      if (snapshot.empty) return deleted;
      for (const document of snapshot.docs) {
        deleted += await this.purgeEventDeliveries(document.id);
        await this.db.runTransaction(async (transaction) => {
          const current = await transaction.get(document.ref);
          if (!current.exists || current.data().status !== "delivered"
            || timestampMillis(current.data().updatedAt) > timestampMillis(cutoff)) return;
          transaction.delete(document.ref);
          deleted += 1;
        });
      }
    }
  }

  async heartbeat(status, errorCode) {
    const update = { status, updatedAt: this.timestamp(this.now()) };
    if (errorCode) update.errorCode = errorCode;
    else if (this.FieldValue) update.errorCode = this.FieldValue.delete();
    await this.stateRef().set(update, { merge: true });
  }
}
