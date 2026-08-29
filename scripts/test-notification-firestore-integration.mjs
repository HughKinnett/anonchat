import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreNotificationAdapter } from "../notification-firestore-adapter.mjs";
import {
  MAX_NOTIFICATION_ATTEMPTS,
  MAX_SUBSCRIPTIONS_PER_RECIPIENT,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_RETENTION_MS,
  NOTIFICATION_TYPES,
  createDeliveryId,
  createSubscriptionVersionFingerprint,
  queuedEvent,
  retryDelayMs
} from "../notification-policy.mjs";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator is required");
const app = initializeApp({ projectId: "anonchat-notification-integration" }, "notification-integration");
const db = getFirestore(app);
const clock = { now: 1_800_000_000_000 };
let tokenNumber = 0;
const adapter = new FirestoreNotificationAdapter({
  db, Timestamp, FieldPath, FieldValue,
  clock: () => clock.now,
  tokenFactory: () => `lease-${++tokenNumber}`
});
const putMany = async (entries) => {
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch();
    entries.slice(offset, offset + 400).forEach(([path, data]) => batch.set(db.doc(path), data));
    await batch.commit();
  }
};
const deleteMany = async (paths) => {
  for (let offset = 0; offset < paths.length; offset += 400) {
    const batch = db.batch();
    paths.slice(offset, offset + 400).forEach((path) => batch.delete(db.doc(path)));
    await batch.commit();
  }
};

const bootstrapStartedAt = Date.now();
assert.equal(await adapter.bootstrapSourceCursors(NOTIFICATION_TYPES), true);
const bootstrapFinishedAt = Date.now();
assert.equal(await adapter.bootstrapSourceCursors(NOTIFICATION_TYPES), false);
const state = (await db.doc("system/notificationProcessor").get()).data();
assert.deepEqual(Object.keys(state.cursors).sort(), [...NOTIFICATION_TYPES].sort());
assert.equal(state.nextSourceType, "reaction", "bootstrap persists the first fair source priority");
for (const cursor of Object.values(state.cursors)) {
  assert.ok(cursor.createdAt.toMillis() >= bootstrapStartedAt - 5_000 && cursor.createdAt.toMillis() <= bootstrapFinishedAt + 5_000, "bootstrap cursor uses Firestore server time, not the injected processor clock");
  assert.notEqual(cursor.createdAt.toMillis(), clock.now);
  assert.equal(cursor.path, "\uf8ff");
}

clock.now += 1_000;
const sourceTimestamp = Timestamp.fromMillis(clock.now);
const preciseSeconds = Math.floor(clock.now / 1_000);
const preciseEarly = new Timestamp(preciseSeconds, 1_000);
const preciseLater = new Timestamp(preciseSeconds, 2_000);
const sourceEntries = Array.from({ length: 105 }, (_, index) => [
  `messageRequests/request-${String(index).padStart(3, "0")}`,
  { fromId: `actor-${index}`, toId: "recipient", status: "pending", createdAt: sourceTimestamp }
]);
await putMany([
  ...sourceEntries,
  ["posts/source-post", { authorId: "recipient", createdAt: sourceTimestamp }],
  ["posts/source-post/comments/source-comment", { uid: "actor", text: "private", createdAt: sourceTimestamp }],
  ["posts/source-post/reactions/source-reaction", { uid: "actor", type: "heart", createdAt: sourceTimestamp }],
  ["reveals/z-earlier-path", { fromId: "actor", toId: "recipient", status: "pending", createdAt: preciseEarly }],
  ["reveals/a-later-path", { fromId: "actor", toId: "recipient", status: "pending", createdAt: preciseLater }]
]);
const commentPage = await adapter.scanSourcePage("comment");
const reactionPage = await adapter.scanSourcePage("reaction");
assert.deepEqual(commentPage.items.map((item) => item.path), ["posts/source-post/comments/source-comment"]);
assert.deepEqual(reactionPage.items.map((item) => item.path), ["posts/source-post/reactions/source-reaction"]);
const precisePage = await adapter.scanSourcePage("reveal-request");
assert.deepEqual(precisePage.items.map((item) => item.path), ["reveals/z-earlier-path", "reveals/a-later-path"],
  "Firestore scanning orders nanoseconds before full path inside one millisecond");
await adapter.advanceSourceCursor(
  "reveal-request",
  { createdAt: preciseEarly, path: "reveals/z-earlier-path" },
  "comment"
);
const stateAfterPreciseCursor = (await db.doc("system/notificationProcessor").get()).data();
const persistedPreciseCursor = stateAfterPreciseCursor.cursors["reveal-request"];
assert.equal(persistedPreciseCursor.createdAt.seconds, preciseEarly.seconds);
assert.equal(persistedPreciseCursor.createdAt.nanoseconds, preciseEarly.nanoseconds);
assert.equal(stateAfterPreciseCursor.nextSourceType, "comment",
  "cursor advancement atomically rotates the persistent source priority");
await adapter.prioritizeSourceType("room-message");
assert.equal(await adapter.sourcePriority(), "room-message",
  "an interrupted source type can persist next-run priority without advancing its cursor");
await adapter.prioritizeSourceType("reaction");
const laterNanosecondPage = await adapter.scanSourcePage("reveal-request");
assert.deepEqual(laterNanosecondPage.items.map((item) => item.path), ["reveals/a-later-path"],
  "a later-nanosecond source progresses even when its full path sorts earlier");
const firstPage = await adapter.scanSourcePage("message-request");
assert.equal(firstPage.items.length, 100);
assert.equal(firstPage.items[0].path, "messageRequests/request-000");
assert.equal(firstPage.items.at(-1).path, "messageRequests/request-099");
await adapter.advanceSourceCursor("message-request", firstPage.nextCursor);
const secondPage = await adapter.scanSourcePage("message-request");
assert.equal(secondPage.items.length, 5);
assert.equal(secondPage.items[0].path, "messageRequests/request-100");
assert.equal(secondPage.items.at(-1).path, "messageRequests/request-104");
await adapter.advanceSourceCursor("message-request", secondPage.nextCursor);
await adapter.advanceSourceCursor("message-request", firstPage.nextCursor);
assert.equal((await db.doc("system/notificationProcessor").get()).data().cursors["message-request"].path, "messageRequests/request-104", "cursor never regresses");

await putMany([
  ["users/post-owner", { uid: "post-owner", banned: false }],
  ["users/room-owner", { uid: "room-owner", banned: false }],
  ["users/recipient", { uid: "recipient", banned: false }],
  ["users/banned-recipient", { uid: "banned-recipient", banned: true }],
  ["users/admin-deleting-recipient", { uid: "admin-deleting-recipient", banned: true }],
  ["users/self-deleting-recipient", { uid: "self-deleting-recipient", banned: false }],
  ["users/transition-recipient", { uid: "transition-recipient", banned: false }],
  ["adminDeletionJobs/admin-deleting-recipient", { status: "queued" }],
  ["accountDeletionRequests/self-deleting-recipient", { status: "queued" }],
  ["posts/post-a", { authorId: "post-owner" }],
  ["rooms/room-a", { ownerId: "room-owner", moderationState: "visible", cleanupState: "open", expiresAt: Timestamp.fromMillis(clock.now + 60_000) }],
  ["roomMembers/room-a_sender", { roomId: "room-a", uid: "sender" }],
  ["roomMembers/room-a_member-b", { roomId: "room-a", uid: "member-b" }],
  ["roomMembers/room-a_member-a", { roomId: "room-a", uid: "member-a" }],
  ["pushSubscriptions/sub-a", { uid: "recipient", endpoint: "https://push.example/a", expirationTime: null, p256dh: "key-a", auth: "auth-a", createdAt: preciseEarly, updatedAt: preciseEarly }],
  ["pushSubscriptions/sub-other", { uid: "other", endpoint: "https://push.example/other", expirationTime: null, p256dh: "key-other", auth: "auth-other", createdAt: preciseEarly, updatedAt: preciseEarly }]
]);
assert.equal(await adapter.postAuthor({ path: "posts/post-a/comments/comment-a" }), "post-owner");
assert.deepEqual((await adapter.roomMembers({ data: { roomId: "room-a" } })).sort(), ["member-a", "member-b", "sender"]);
assert.equal(await adapter.roomAvailable("room-a"), true);
await db.doc("rooms/room-a").update({ moderationState: "hidden" });
assert.equal(await adapter.roomAvailable("room-a"), false, "a reported room is unavailable when push delivery revalidates it");
await db.doc("rooms/room-a").update({ moderationState: "visible", expiresAt: Timestamp.fromMillis(clock.now - 1) });
assert.equal(await adapter.roomAvailable("room-a"), false, "an expired room is unavailable at delivery time");
await db.doc("rooms/room-a").update({ expiresAt: Timestamp.fromMillis(clock.now + 60_000) });
assert.equal(await adapter.recipientAvailable("post-owner"), true);
assert.equal(await adapter.recipientAvailable("missing-user"), false);
assert.equal(await adapter.recipientAvailable("banned-recipient"), false);
assert.equal(await adapter.pairBlocked("actor", "recipient"), false);
await db.doc("blocks/actor_recipient").set({ blockerUid: "actor", blockedUid: "recipient" });
assert.equal(await adapter.pairBlocked("actor", "recipient"), true,
  "trusted filtering finds an actor-to-recipient block with two deterministic reads");
assert.deepEqual(await adapter.unblockedRecipients("actor", ["recipient", "post-owner"]), ["post-owner"],
  "one bounded actor block snapshot filters an entire recipient batch");
await db.doc("blocks/actor_recipient").delete();
await db.doc("blocks/recipient_actor").set({ blockerUid: "recipient", blockedUid: "actor" });
assert.equal(await adapter.pairBlocked("actor", "recipient"), true,
  "trusted filtering finds the reverse block direction");
assert.deepEqual(await adapter.unblockedRecipients("actor", ["recipient", "post-owner"]), ["post-owner"],
  "recipient-created blocks are included in the bounded actor snapshot");
await db.doc("blocks/recipient_actor").delete();
assert.equal(await adapter.recipientAvailable("admin-deleting-recipient"), false);
assert.equal(await adapter.recipientAvailable("self-deleting-recipient"), false);
assert.equal(await adapter.recipientAvailable("transition-recipient"), true);
await db.doc("adminDeletionJobs/transition-recipient").set({ status: "queued" });
assert.equal(await adapter.recipientAvailable("transition-recipient"), false,
  "recipient availability is re-readable after an event was queued");
assert.deepEqual((await adapter.listSubscriptions("recipient")).map((subscription) => subscription.id), ["sub-a"]);

const roomStateEventId = "f".repeat(64);
await adapter.createEvent(roomStateEventId, queuedEvent({
  type: "room-message", actorUid: "sender", recipientUid: "recipient", roomId: "room-a", route: "/community.html#rooms-panel",
  sourceCreatedAt: Timestamp.fromMillis(clock.now - 1), now: Timestamp.fromMillis(clock.now)
}));
const roomStateClaim = await adapter.claimEvent(roomStateEventId, "room-state-worker");
assert.equal(roomStateClaim.data.roomId, "room-a", "the claimed processing state retains room identity");
await adapter.suppressEvent(roomStateEventId, roomStateClaim.token, "ROOM_UNAVAILABLE");
const suppressedRoomEvent = (await db.doc(`notificationEvents/${roomStateEventId}`).get()).data();
assert.equal(suppressedRoomEvent.roomId, "room-a", "the terminal suppression state retains room identity");
assert.equal(suppressedRoomEvent.errorCode, "ROOM_UNAVAILABLE");
await db.doc(`notificationEvents/${roomStateEventId}`).delete();

const legacyRoomEventId = "e".repeat(64);
const { roomId: legacyRoomId, ...legacyRoomEvent } = queuedEvent({
  type: "room-message", actorUid: "sender", recipientUid: "recipient", roomId: "room-a", route: "/community.html#rooms-panel",
  sourceCreatedAt: Timestamp.fromMillis(clock.now - 1), now: Timestamp.fromMillis(clock.now)
});
void legacyRoomId;
await db.doc(`notificationEvents/${legacyRoomEventId}`).set(legacyRoomEvent);
const legacyRoomClaim = await adapter.claimEvent(legacyRoomEventId, "legacy-room-worker");
assert.deepEqual(legacyRoomClaim, { id: legacyRoomEventId, terminal: "suppressed", errorCode: "LEGACY_ROOM_CONTEXT_MISSING" },
  "a legacy room event without a delivery-time room fence is terminally suppressed without delivery");
const suppressedLegacyRoomEvent = (await db.doc(`notificationEvents/${legacyRoomEventId}`).get()).data();
assert.equal(suppressedLegacyRoomEvent.status, "suppressed");
assert.equal(suppressedLegacyRoomEvent.errorCode, "LEGACY_ROOM_CONTEXT_MISSING");
assert.equal(Object.hasOwn(suppressedLegacyRoomEvent, "roomId"), false,
  "the auditable compatibility state never invents room identity");
await db.doc(`notificationEvents/${legacyRoomEventId}`).delete();

const queryShape = {};
const shapeAdapter = new FirestoreNotificationAdapter({
  db: {
    collection: (name) => {
      assert.equal(name, "pushSubscriptions");
      return {
        where: (field, operator, value) => {
          Object.assign(queryShape, { field, operator, value });
          return {
            limit: (limitValue) => {
              queryShape.limit = limitValue;
              return { get: async () => ({ docs: [] }) };
            }
          };
        }
      };
    }
  },
  Timestamp, FieldPath, FieldValue
});
assert.deepEqual(await shapeAdapter.listSubscriptions("shape-user"), []);
assert.deepEqual(queryShape, { field: "uid", operator: "==", value: "shape-user", limit: MAX_SUBSCRIPTIONS_PER_RECIPIENT + 1 },
  "the production subscription query is bounded at limit(101)");

const cappedSubscriptions = Array.from({ length: MAX_SUBSCRIPTIONS_PER_RECIPIENT + 1 }, (_, index) => [
  `pushSubscriptions/cap-${String(index).padStart(3, "0")}`,
  { uid: "cap-user", endpoint: `https://push.example/cap-${index}`, expirationTime: null, p256dh: `key-${index}`, auth: `auth-${index}`, createdAt: preciseEarly, updatedAt: preciseEarly }
]);
await putMany(cappedSubscriptions.slice(0, MAX_SUBSCRIPTIONS_PER_RECIPIENT));
assert.equal((await adapter.listSubscriptions("cap-user")).length, 100, "100 subscriptions are allowed by the production adapter");
await putMany(cappedSubscriptions.slice(MAX_SUBSCRIPTIONS_PER_RECIPIENT));
await assert.rejects(() => adapter.listSubscriptions("cap-user"), (error) => error.code === "subscription-limit",
  "101 subscriptions fail closed instead of truncating or paging");

const activeEvent = (overrides = {}) => ({
  ...queuedEvent({
    type: "reaction",
    actorUid: "actor",
    recipientUid: "recipient",
    route: "/timeline.html",
    sourceCreatedAt: Timestamp.fromMillis(clock.now - 1),
    now: Timestamp.fromMillis(clock.now)
  }),
  ...overrides
});
const futureRetryPaths = Array.from({ length: 105 }, (_, index) =>
  `notificationEvents/a-future-${String(index).padStart(3, "0")}`);
const readyEventPaths = [
  "notificationEvents/z-pending-ready",
  "notificationEvents/z-failed-due",
  "notificationEvents/z-processing-expired"
];
const liveLeasePath = "notificationEvents/a-processing-live";
await putMany([
  ...futureRetryPaths.map((path) => [path, activeEvent({
    status: "failed",
    attempts: 1,
    errorCode: "DELIVERY_TRANSIENT",
    retryAt: Timestamp.fromMillis(clock.now + 60_000)
  })]),
  [readyEventPaths[0], activeEvent()],
  [readyEventPaths[1], activeEvent({
    status: "failed",
    attempts: 1,
    errorCode: "DELIVERY_TRANSIENT",
    retryAt: Timestamp.fromMillis(clock.now)
  })],
  [readyEventPaths[2], activeEvent({
    status: "processing",
    attempts: 1,
    leaseOwner: "expired-worker",
    leaseToken: "expired-token",
    leaseExpiresAt: Timestamp.fromMillis(clock.now - 1)
  })],
  [liveLeasePath, activeEvent({
    status: "processing",
    attempts: 1,
    leaseOwner: "live-worker",
    leaseToken: "live-token",
    leaseExpiresAt: Timestamp.fromMillis(clock.now + NOTIFICATION_LEASE_MS)
  })]
]);
assert.deepEqual(
  (await adapter.scanEventPage()).items.map((item) => `notificationEvents/${item.id}`).sort(),
  [...readyEventPaths].sort(),
  "the production active scan excludes more than one page of future retries and live leases without starving later ready work"
);
await deleteMany([...futureRetryPaths, ...readyEventPaths, liveLeasePath]);

const eventId = "a".repeat(64);
const nowTimestamp = Timestamp.fromMillis(clock.now);
const event = queuedEvent({
  type: "reaction", actorUid: "actor", recipientUid: "recipient", route: "/timeline.html",
  sourceCreatedAt: Timestamp.fromMillis(clock.now - 1), now: nowTimestamp
});
assert.equal(await adapter.createEvent(eventId, event), true);
assert.equal(await adapter.createEvent(eventId, { ...event, actorUid: "forged-overwrite" }), false);
assert.equal((await db.doc(`notificationEvents/${eventId}`).get()).data().actorUid, "actor");

const firstClaim = await adapter.claimEvent(eventId, "worker-a");
assert.equal(firstClaim.data.attempts, 1);
assert.equal(await adapter.claimEvent(eventId, "worker-b"), null);
clock.now += NOTIFICATION_LEASE_MS + 1;
const recovered = await adapter.claimEvent(eventId, "worker-b");
assert.equal(recovered.data.attempts, 2);
await assert.rejects(() => adapter.completeEvent(eventId, firstClaim.token), (error) => error.code === "lease-lost");

const deliveryId = "b".repeat(64);
const delivery = {
  eventId, recipientUid: "recipient", subscriptionId: "sub-a", status: "delivered",
  createdAt: Timestamp.fromMillis(clock.now), updatedAt: Timestamp.fromMillis(clock.now)
};
assert.equal(await adapter.markDelivery(deliveryId, delivery), true);
assert.equal(await adapter.markDelivery(deliveryId, { ...delivery, status: "expired" }), false);
assert.equal((await adapter.getDelivery(deliveryId)).status, "delivered");
assert.equal(await adapter.failEvent(eventId, recovered.token, "DELIVERY_TRANSIENT"), "failed");
const failedEvent = (await db.doc(`notificationEvents/${eventId}`).get()).data();
assert.equal(failedEvent.errorCode, "DELIVERY_TRANSIENT");
assert.equal(failedEvent.retryAt.toMillis() - failedEvent.updatedAt.toMillis(), retryDelayMs(failedEvent.attempts));
assert.equal(await adapter.claimEvent(eventId, "too-early-worker"), null, "bounded backoff blocks an immediate retry");
clock.now = failedEvent.retryAt.toMillis();
const retry = await adapter.claimEvent(eventId, "worker-c");
await adapter.completeEvent(eventId, retry.token);
  const deliveredEvent = (await db.doc(`notificationEvents/${eventId}`).get()).data();
  assert.equal(deliveredEvent.status, "delivered");
  assert.equal(Object.hasOwn(deliveredEvent, "leaseToken"), false);
  assert.equal(Object.hasOwn(deliveredEvent, "errorCode"), false);
  assert.equal((await adapter.scanEventPage()).items.some((item) => item.id === eventId), false, "delivered retention records do not consume the active queue scan");

const exhaustedEventId = "e".repeat(64);
await db.doc(`notificationEvents/${exhaustedEventId}`).set({
  ...queuedEvent({
    type: "comment",
    actorUid: "actor",
    recipientUid: "recipient",
    route: "/timeline.html",
    sourceCreatedAt: Timestamp.fromMillis(clock.now - 1),
    now: Timestamp.fromMillis(clock.now)
  }),
  status: "failed",
  attempts: MAX_NOTIFICATION_ATTEMPTS - 1,
  errorCode: "DELIVERY_TRANSIENT",
  retryAt: Timestamp.fromMillis(clock.now)
});
const finalAttempt = await adapter.claimEvent(exhaustedEventId, "final-attempt-worker");
assert.equal(finalAttempt.data.attempts, MAX_NOTIFICATION_ATTEMPTS);
assert.equal(await adapter.failEvent(exhaustedEventId, finalAttempt.token, "DELIVERY_TRANSIENT"), "exhausted");
const exhaustedEvent = (await db.doc(`notificationEvents/${exhaustedEventId}`).get()).data();
assert.equal(exhaustedEvent.status, "exhausted");
assert.equal(exhaustedEvent.errorCode, "DELIVERY_EXHAUSTED");
assert.equal(Object.hasOwn(exhaustedEvent, "retryAt"), false);
assert.equal((await adapter.scanEventPage()).items.some((item) => item.id === exhaustedEventId), false,
  "dead-letter events never re-enter active delivery scans");

const expiredDelivery = (deliveryEventId, subscriptionId, fingerprint) => ({
  eventId: deliveryEventId,
  recipientUid: "recipient",
  subscriptionId,
  subscriptionFingerprint: fingerprint,
  status: "expired",
  createdAt: Timestamp.fromMillis(clock.now),
  updatedAt: Timestamp.fromMillis(clock.now)
});
let subscriptionSnapshot = (await adapter.listSubscriptions("recipient"))[0];
let subscriptionFingerprint = await createSubscriptionVersionFingerprint(subscriptionSnapshot);
let expiredDeliveryId = await createDeliveryId(eventId, subscriptionSnapshot.id, subscriptionFingerprint);
await db.doc("pushSubscriptions/sub-a").update({ updatedAt: preciseLater });
assert.equal(await adapter.expireSubscriptionVersion(subscriptionSnapshot, expiredDeliveryId,
  expiredDelivery(eventId, subscriptionSnapshot.id, subscriptionFingerprint)), false,
  "an updatedAt-only refresh is not deleted or marked expired by a stale 410 response");
assert.equal((await db.doc(`notificationDeliveries/${expiredDeliveryId}`).get()).exists, false);

subscriptionSnapshot = (await adapter.listSubscriptions("recipient"))[0];
subscriptionFingerprint = await createSubscriptionVersionFingerprint(subscriptionSnapshot);
expiredDeliveryId = await createDeliveryId(eventId, subscriptionSnapshot.id, subscriptionFingerprint);
await db.doc("pushSubscriptions/sub-a").update({ expirationTime: 123456 });
assert.equal(await adapter.expireSubscriptionVersion(subscriptionSnapshot, expiredDeliveryId,
  expiredDelivery(eventId, subscriptionSnapshot.id, subscriptionFingerprint)), false,
  "an expiration-only refresh is not deleted or marked expired by a stale 410 response");
assert.equal((await db.doc(`notificationDeliveries/${expiredDeliveryId}`).get()).exists, false);

subscriptionSnapshot = (await adapter.listSubscriptions("recipient"))[0];
subscriptionFingerprint = await createSubscriptionVersionFingerprint(subscriptionSnapshot);
expiredDeliveryId = await createDeliveryId(eventId, subscriptionSnapshot.id, subscriptionFingerprint);
const recreatedSubscription = {
  uid: "recipient", endpoint: "https://push.example/a", expirationTime: 654321,
  p256dh: "key-a", auth: "recreated-auth", createdAt: preciseLater, updatedAt: preciseLater
};
const transactionAttempts = [];
const retryDb = {
  collection: (name) => ({ doc: (documentId) => ({ path: `${name}/${documentId}` }) }),
  runTransaction: async (operation) => {
    for (const current of [subscriptionSnapshot, recreatedSubscription]) {
      const writes = [];
      const result = await operation({
        get: async (reference) => reference.path === "pushSubscriptions/sub-a"
          ? { exists: true, data: () => current }
          : { exists: false },
        delete: (reference) => writes.push(`delete:${reference.path}`),
        create: (reference) => writes.push(`create:${reference.path}`)
      });
      transactionAttempts.push(writes);
      if (current === recreatedSubscription) return result;
    }
  }
};
const retryAdapter = new FirestoreNotificationAdapter({ db: retryDb, Timestamp, FieldPath, FieldValue });
assert.equal(await retryAdapter.expireSubscriptionVersion(subscriptionSnapshot, expiredDeliveryId,
  expiredDelivery(eventId, subscriptionSnapshot.id, subscriptionFingerprint)), false,
  "a transaction retried after delete/recreate rechecks and preserves the new version");
assert.deepEqual(transactionAttempts, [
  ["delete:pushSubscriptions/sub-a", `create:notificationDeliveries/${expiredDeliveryId}`],
  []
], "the conflicted attempt is discarded and the retried version performs no writes");

await db.doc("pushSubscriptions/sub-a").delete();
await db.doc("pushSubscriptions/sub-a").set(recreatedSubscription);
assert.equal(await adapter.expireSubscriptionVersion(subscriptionSnapshot, expiredDeliveryId,
  expiredDelivery(eventId, subscriptionSnapshot.id, subscriptionFingerprint)), false,
  "the emulator adapter preserves a subscription deleted and recreated before its exact-version transaction");
assert.equal((await db.doc(`notificationDeliveries/${expiredDeliveryId}`).get()).exists, false);

subscriptionSnapshot = (await adapter.listSubscriptions("recipient"))[0];
subscriptionFingerprint = await createSubscriptionVersionFingerprint(subscriptionSnapshot);
expiredDeliveryId = await createDeliveryId(eventId, subscriptionSnapshot.id, subscriptionFingerprint);
assert.equal(await adapter.expireSubscriptionVersion(subscriptionSnapshot, expiredDeliveryId,
  expiredDelivery(eventId, subscriptionSnapshot.id, subscriptionFingerprint)), true);
assert.equal((await db.doc("pushSubscriptions/sub-a").get()).exists, false);
assert.equal((await db.doc(`notificationDeliveries/${expiredDeliveryId}`).get()).data().status, "expired",
  "exact deletion and its version-specific marker commit atomically");

await adapter.heartbeat("completed");
assert.equal((await db.doc("system/notificationProcessor").get()).data().status, "completed");
clock.now += NOTIFICATION_RETENTION_MS + 1;
const purged = await adapter.purgeTerminalBefore(Timestamp.fromMillis(clock.now - NOTIFICATION_RETENTION_MS));
assert.equal(purged, 4, "delivered and dead-letter events plus version-specific markers are retained then purged");
assert.equal((await db.doc(`notificationEvents/${eventId}`).get()).exists, false);
assert.equal((await db.doc(`notificationEvents/${exhaustedEventId}`).get()).exists, false);
assert.equal((await db.doc(`notificationDeliveries/${deliveryId}`).get()).exists, false);
assert.equal((await db.doc(`notificationDeliveries/${expiredDeliveryId}`).get()).exists, false);

await deleteApp(app);
console.log("Notification production Firestore integration passed");
