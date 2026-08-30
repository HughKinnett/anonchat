import {
  ACCOUNT_LIMIT,
  MAX_NOTIFICATION_ATTEMPTS,
  MAX_NOTIFICATION_SENDS_PER_RUN,
  MAX_SUBSCRIPTIONS_PER_RECIPIENT,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_PAGE_LIMIT,
  NOTIFICATION_TYPES,
  canonicalSubscriptionVersion,
  compareSourceCursors,
  isValidQueueEvent,
  isLegacyRoomEventMissingContext,
  retryDelayMs,
  shouldExhaustNotification,
  TERMINAL_NOTIFICATION_STATUSES,
  timestampMillis
} from "./notification-policy.mjs";
import { blockId } from "./moderation-policy.mjs";

const PROCESSOR_PATH = "system/notificationProcessor";
const SOURCE_COLLECTIONS = Object.freeze({
  reaction: { collection: "reactions", group: true },
  comment: { collection: "comments", group: true },
  "private-message": { collection: "messages", group: true },
  "message-request": { collection: "messageRequests" },
  "room-message": { collection: "roomMessages" },
  "reveal-request": { collection: "reveals" }
});
const codedError = (code) => Object.assign(new Error(code), { code });
const sameSubscriptionVersion = (left, right) => {
  try { return canonicalSubscriptionVersion(left) === canonicalSubscriptionVersion(right); }
  catch { return false; }
};

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
        nextSourceType: types[0],
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

  async sourcePriority() {
    const snapshot = await this.stateRef().get();
    const stored = snapshot.exists ? snapshot.data().nextSourceType : undefined;
    return NOTIFICATION_TYPES.includes(stored) ? stored : NOTIFICATION_TYPES[0];
  }

  async prioritizeSourceType(type) {
    if (!NOTIFICATION_TYPES.includes(type)) throw codedError("invalid-source-type");
    await this.stateRef().update({
      nextSourceType: type,
      updatedAt: this.FieldValue.serverTimestamp()
    });
  }

  async scanSourcePage(type, suppliedCursor, requestedLimit = NOTIFICATION_PAGE_LIMIT) {
    const descriptor = SOURCE_COLLECTIONS[type];
    if (!descriptor) throw codedError("invalid-source-type");
    const cursor = suppliedCursor ?? await this.storedCursor(type);
    const base = descriptor.group
      ? this.db.collectionGroup(descriptor.collection)
      : this.db.collection(descriptor.collection);
    const pageLimit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, NOTIFICATION_PAGE_LIMIT)
      : NOTIFICATION_PAGE_LIMIT;
    let query = base.orderBy("createdAt").orderBy(this.FieldPath.documentId()).limit(pageLimit);
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

  async advanceSourceCursor(type, cursor, nextSourceType) {
    if (!NOTIFICATION_TYPES.includes(type)
      || nextSourceType !== undefined && !NOTIFICATION_TYPES.includes(nextSourceType)) {
      throw codedError("invalid-source-type");
    }
    await this.db.runTransaction(async (transaction) => {
      const reference = this.stateRef();
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("cursor-state-missing");
      const current = snapshot.data().cursors?.[type];
      const updates = {};
      if (!current || compareSourceCursors(cursor, current) > 0) updates[`cursors.${type}`] = cursor;
      if (nextSourceType !== undefined) updates.nextSourceType = nextSourceType;
      if (Object.keys(updates).length) transaction.update(reference, updates);
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

  async userName(uid) {
    const snapshot = await this.db.collection("users").doc(uid).get();
    const username = snapshot.exists ? snapshot.data().username : "";
    return typeof username === "string" && /^[A-Za-z0-9_]{1,40}$/.test(username)
      ? username
      : "Someone";
  }

  async roomAlias(roomId, senderId, sourceCreatedAt) {
    const snapshot = await this.db.collection("roomMessages")
      .where("roomId", "==", roomId)
      .where("senderId", "==", senderId)
      .where("createdAt", "==", sourceCreatedAt)
      .limit(1)
      .get();
    const alias = snapshot.docs[0]?.data()?.tempName;
    return typeof alias === "string" && /^[A-Za-z0-9_]{1,40}$/.test(alias)
      ? alias
      : "Someone";
  }

  async roomMembers(source) {
    const snapshot = await this.db.collection("roomMembers")
      .where("roomId", "==", source?.data?.roomId)
      .orderBy(this.FieldPath.documentId())
      .limit(ACCOUNT_LIMIT)
      .get();
    return snapshot.docs.map((document) => document.data().uid);
  }

  async roomAvailable(roomId) {
    if (typeof roomId !== "string" || !roomId || roomId.includes("/")) return false;
    const room = await this.db.collection("rooms").doc(roomId).get();
    if (!room.exists) return false;
    const data = room.data();
    return typeof data.ownerId === "string" && data.ownerId.length > 0
      && data.moderationState === "visible"
      && data.cleanupState !== "closing"
      && Number.isFinite(timestampMillis(data.expiresAt))
      && timestampMillis(data.expiresAt) > this.now()
      && await this.recipientAvailable(data.ownerId);
  }

  async recipientAvailable(uid) {
    const [profile, adminDeletion, selfDeletion] = await Promise.all([
      this.db.collection("users").doc(uid).get(),
      this.db.collection("adminDeletionJobs").doc(uid).get(),
      this.db.collection("accountDeletionRequests").doc(uid).get()
    ]);
    return profile.exists && profile.data().banned !== true && !adminDeletion.exists && !selfDeletion.exists;
  }

  async pairBlocked(left, right) {
    if (typeof left !== "string" || !left || typeof right !== "string" || !right || left === right) return false;
    const snapshots = await this.db.getAll(
      this.db.collection("blocks").doc(blockId(left, right)),
      this.db.collection("blocks").doc(blockId(right, left))
    );
    return snapshots.some((snapshot) => snapshot.exists);
  }

  async unblockedRecipients(actorUid, recipientUids) {
    const recipients = [...new Set(recipientUids)]
      .filter((uid) => typeof uid === "string" && uid && uid !== actorUid)
      .slice(0, ACCOUNT_LIMIT - 1);
    if (typeof actorUid !== "string" || !actorUid || !recipients.length) return [];
    const blocks = this.db.collection("blocks");
    const [outgoing, incoming] = await Promise.all([
      blocks.where("blockerUid", "==", actorUid).limit(ACCOUNT_LIMIT).get(),
      blocks.where("blockedUid", "==", actorUid).limit(ACCOUNT_LIMIT).get()
    ]);
    const blocked = new Set([
      ...outgoing.docs.map((document) => document.data().blockedUid),
      ...incoming.docs.map((document) => document.data().blockerUid)
    ]);
    return recipients.filter((uid) => !blocked.has(uid));
  }

  async createEvent(eventId, data) {
    return (await this.createEvents([[eventId, data]])) === 1;
  }

  async createEvents(entries) {
    if (!Array.isArray(entries) || entries.length > ACCOUNT_LIMIT - 1
      || entries.some((entry) => !Array.isArray(entry) || entry.length !== 2
        || typeof entry[0] !== "string" || !entry[0])) throw codedError("event-batch-invalid");
    if (!entries.length) return 0;
    const uniqueEntries = new Map(entries);
    if (uniqueEntries.size !== entries.length) throw codedError("event-batch-invalid");
    return this.db.runTransaction(async (transaction) => {
      const prepared = [...uniqueEntries].map(([eventId, data]) => ({
        reference: this.eventRef(eventId),
        data
      }));
      const snapshots = await transaction.getAll(...prepared.map(({ reference }) => reference));
      let created = 0;
      snapshots.forEach((snapshot, index) => {
        if (snapshot.exists) return;
        transaction.create(prepared[index].reference, prepared[index].data);
        created += 1;
      });
      return created;
    });
  }

  async scanEligibleStatus({ status, dueField, cursor }) {
    let query = this.db.collection("notificationEvents").where("status", "==", status);
    if (dueField) {
      query = query
        .where(dueField, "<=", this.timestamp(this.now()))
        .orderBy(dueField)
        .orderBy(this.FieldPath.documentId());
      if (cursor) query = query.startAfter(cursor.at, cursor.id);
    } else {
      query = query.orderBy(this.FieldPath.documentId());
      if (cursor) query = query.startAfter(cursor);
    }
    query = query.limit(NOTIFICATION_PAGE_LIMIT);
    const snapshot = await query.get();
    return snapshot.docs.map((document) => {
      const data = document.data();
      return {
        id: document.id,
        data,
        cursor: dueField ? { at: data[dueField], id: document.id } : document.id
      };
    });
  }

  async scanEventPage(cursor = {}) {
    const descriptors = [
      { status: "pending" },
      { status: "failed", dueField: "retryAt" },
      { status: "processing", dueField: "leaseExpiresAt" }
    ];
    const streams = await Promise.all(descriptors.map(async (descriptor) => ({
      ...descriptor,
      items: await this.scanEligibleStatus({ ...descriptor, cursor: cursor?.[descriptor.status] })
    })));
    const nextCursor = { ...cursor };
    const items = [];
    while (items.length < NOTIFICATION_PAGE_LIMIT && streams.some((stream) => stream.items.length)) {
      for (const stream of streams) {
        const item = stream.items.shift();
        if (!item) continue;
        nextCursor[stream.status] = item.cursor;
        items.push({ id: item.id, data: item.data });
        if (items.length >= NOTIFICATION_PAGE_LIMIT) break;
      }
    }
    return { items, nextCursor: items.length ? nextCursor : undefined };
  }

  claimable(event) {
    return event?.status === "pending" || (
      event?.status === "failed"
      && (!Number.isFinite(timestampMillis(event.retryAt)) || timestampMillis(event.retryAt) <= this.now())
    ) || (
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
      if (!snapshot.exists) return null;
      const event = snapshot.data();
      if (isLegacyRoomEventMissingContext(event)) {
        const errorCode = "LEGACY_ROOM_CONTEXT_MISSING";
        transaction.set(reference, {
          type: event.type,
          actorUid: event.actorUid,
          recipientUid: event.recipientUid,
          route: event.route,
          sourceCreatedAt: event.sourceCreatedAt,
          status: "suppressed",
          attempts: event.attempts,
          createdAt: event.createdAt,
          updatedAt: this.timestamp(this.now()),
          errorCode
        });
        return { id: eventId, terminal: "suppressed", errorCode };
      }
      if (!isValidQueueEvent(event)) {
        transaction.set(reference, {
          status: "exhausted",
          attempts: Number.isInteger(event?.attempts) && event.attempts >= 0 ? event.attempts : 0,
          createdAt: Number.isFinite(timestampMillis(event?.createdAt)) ? event.createdAt : this.timestamp(this.now()),
          updatedAt: this.timestamp(this.now()),
          errorCode: "INVALID_EVENT"
        });
        return { id: eventId, terminal: "exhausted" };
      }
      if (event.status === "processing" && !this.claimable(event)) return null;
      if (shouldExhaustNotification(event, this.now())) {
        transaction.set(reference, this.settledEvent(
          event,
          "exhausted",
          this.timestamp(this.now()),
          "DELIVERY_EXHAUSTED"
        ));
        return { id: eventId, terminal: "exhausted" };
      }
      if (!this.claimable(event)) return null;
      const leaseToken = this.tokenFactory();
      const claimed = {
        type: event.type,
        actorUid: event.actorUid,
        recipientUid: event.recipientUid,
        ...(event.type === "room-message" ? { roomId: event.roomId } : {}),
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
    const snapshot = await this.db.collection("pushSubscriptions")
      .where("uid", "==", recipientUid)
      .limit(MAX_SUBSCRIPTIONS_PER_RECIPIENT + 1)
      .get();
    if (snapshot.docs.length > MAX_SUBSCRIPTIONS_PER_RECIPIENT) throw codedError("subscription-limit");
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

  async expireSubscriptionVersion(subscription, deliveryId, delivery) {
    return this.db.runTransaction(async (transaction) => {
      const subscriptionReference = this.db.collection("pushSubscriptions").doc(subscription.id);
      const deliveryReference = this.db.collection("notificationDeliveries").doc(deliveryId);
      const subscriptionSnapshot = await transaction.get(subscriptionReference);
      if (!subscriptionSnapshot.exists || !sameSubscriptionVersion(subscriptionSnapshot.data(), subscription)) return false;
      const deliverySnapshot = await transaction.get(deliveryReference);
      transaction.delete(subscriptionReference);
      if (!deliverySnapshot.exists) transaction.create(deliveryReference, delivery);
      return true;
    });
  }

  settledEvent(event, status, updatedAt, errorCode, retryAt) {
    const settled = {
      type: event.type,
      actorUid: event.actorUid,
      recipientUid: event.recipientUid,
      ...(event.type === "room-message" ? { roomId: event.roomId } : {}),
      route: event.route,
      sourceCreatedAt: event.sourceCreatedAt,
      status,
      attempts: event.attempts,
      createdAt: event.createdAt,
      updatedAt
    };
    if (errorCode) settled.errorCode = errorCode;
    if (retryAt) settled.retryAt = retryAt;
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

  async suppressEvent(eventId, token, errorCode = "RECIPIENT_UNAVAILABLE") {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.eventRef(eventId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLease(snapshot.data(), token);
      transaction.set(reference, this.settledEvent(
        snapshot.data(),
        "suppressed",
        this.timestamp(this.now()),
        errorCode
      ));
    });
  }

  async deferEvent(eventId, token) {
    await this.db.runTransaction(async (transaction) => {
      const reference = this.eventRef(eventId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLease(snapshot.data(), token);
      const event = snapshot.data();
      transaction.set(reference, this.settledEvent({
        ...event,
        attempts: Math.max(0, event.attempts - 1)
      }, "pending", this.timestamp(this.now())));
    });
  }

  async failEvent(eventId, token, errorCode) {
    return this.db.runTransaction(async (transaction) => {
      const reference = this.eventRef(eventId);
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw codedError("lease-lost");
      this.assertLease(snapshot.data(), token);
      const event = snapshot.data();
      if (shouldExhaustNotification(event, this.now()) || event.attempts >= MAX_NOTIFICATION_ATTEMPTS) {
        transaction.set(reference, this.settledEvent(
          event,
          "exhausted",
          this.timestamp(this.now()),
          "DELIVERY_EXHAUSTED"
        ));
        return "exhausted";
      }
      const updatedAt = this.timestamp(this.now());
      transaction.set(reference, this.settledEvent(
        event,
        "failed",
        updatedAt,
        errorCode,
        this.timestamp(this.now() + retryDelayMs(event.attempts))
      ));
      return "failed";
    });
  }

  async purgeEventDeliveries(eventId, maxRecords = MAX_NOTIFICATION_SENDS_PER_RUN) {
    let deleted = 0;
    while (deleted < maxRecords) {
      const limit = Math.min(NOTIFICATION_PAGE_LIMIT, maxRecords - deleted);
      const snapshot = await this.db.collection("notificationDeliveries")
        .where("eventId", "==", eventId)
        .limit(limit)
        .get();
      if (snapshot.empty) return { deleted, complete: true };
      const batch = this.db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
      deleted += snapshot.size;
      if (snapshot.size < limit) return { deleted, complete: true };
    }
    const remaining = await this.db.collection("notificationDeliveries")
      .where("eventId", "==", eventId)
      .limit(1)
      .get();
    return { deleted, complete: remaining.empty };
  }

  async purgeTerminalBefore(
    cutoff,
    maxEvents = NOTIFICATION_PAGE_LIMIT,
    maxDeliveries = MAX_NOTIFICATION_SENDS_PER_RUN
  ) {
    let deleted = 0;
    let inspected = 0;
    let deliveriesDeleted = 0;
    for (const status of TERMINAL_NOTIFICATION_STATUSES) {
      while (inspected < maxEvents) {
        const snapshot = await this.db.collection("notificationEvents")
          .where("status", "==", status)
          .where("updatedAt", "<=", cutoff)
          .limit(Math.min(NOTIFICATION_PAGE_LIMIT, maxEvents - inspected))
          .get();
        if (snapshot.empty) break;
        for (const document of snapshot.docs) {
          inspected += 1;
          const deliveryPurge = await this.purgeEventDeliveries(
            document.id,
            Math.max(0, maxDeliveries - deliveriesDeleted)
          );
          deleted += deliveryPurge.deleted;
          deliveriesDeleted += deliveryPurge.deleted;
          if (!deliveryPurge.complete) continue;
          const removed = await this.db.runTransaction(async (transaction) => {
            const current = await transaction.get(document.ref);
            if (!current.exists || current.data().status !== status
              || timestampMillis(current.data().updatedAt) > timestampMillis(cutoff)) return false;
            transaction.delete(document.ref);
            return true;
          });
          if (removed) deleted += 1;
        }
      }
      if (inspected >= maxEvents) break;
    }
    return deleted;
  }

  async heartbeat(status, errorCode) {
    const update = { status, updatedAt: this.timestamp(this.now()) };
    if (errorCode) update.errorCode = errorCode;
    else if (this.FieldValue) update.errorCode = this.FieldValue.delete();
    await this.stateRef().set(update, { merge: true });
  }
}
