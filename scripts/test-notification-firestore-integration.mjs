import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreNotificationAdapter } from "../notification-firestore-adapter.mjs";
import { NOTIFICATION_LEASE_MS, NOTIFICATION_RETENTION_MS, NOTIFICATION_TYPES, queuedEvent } from "../notification-policy.mjs";

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

const bootstrapStartedAt = Date.now();
assert.equal(await adapter.bootstrapSourceCursors(NOTIFICATION_TYPES), true);
const bootstrapFinishedAt = Date.now();
assert.equal(await adapter.bootstrapSourceCursors(NOTIFICATION_TYPES), false);
const state = (await db.doc("system/notificationProcessor").get()).data();
assert.deepEqual(Object.keys(state.cursors).sort(), [...NOTIFICATION_TYPES].sort());
for (const cursor of Object.values(state.cursors)) {
  assert.ok(cursor.createdAt.toMillis() >= bootstrapStartedAt - 5_000 && cursor.createdAt.toMillis() <= bootstrapFinishedAt + 5_000, "bootstrap cursor uses Firestore server time, not the injected processor clock");
  assert.notEqual(cursor.createdAt.toMillis(), clock.now);
  assert.equal(cursor.path, "\uf8ff");
}

clock.now += 1_000;
const sourceTimestamp = Timestamp.fromMillis(clock.now);
const sourceEntries = Array.from({ length: 105 }, (_, index) => [
  `messageRequests/request-${String(index).padStart(3, "0")}`,
  { fromId: `actor-${index}`, toId: "recipient", status: "pending", createdAt: sourceTimestamp }
]);
await putMany([
  ...sourceEntries,
  ["posts/source-post", { authorId: "recipient", createdAt: sourceTimestamp }],
  ["posts/source-post/comments/source-comment", { uid: "actor", text: "private", createdAt: sourceTimestamp }],
  ["posts/source-post/reactions/source-reaction", { uid: "actor", type: "heart", createdAt: sourceTimestamp }]
]);
const commentPage = await adapter.scanSourcePage("comment");
const reactionPage = await adapter.scanSourcePage("reaction");
assert.deepEqual(commentPage.items.map((item) => item.path), ["posts/source-post/comments/source-comment"]);
assert.deepEqual(reactionPage.items.map((item) => item.path), ["posts/source-post/reactions/source-reaction"]);
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
  ["posts/post-a", { authorId: "post-owner" }],
  ["roomMembers/room-a_sender", { roomId: "room-a", uid: "sender" }],
  ["roomMembers/room-a_member-b", { roomId: "room-a", uid: "member-b" }],
  ["roomMembers/room-a_member-a", { roomId: "room-a", uid: "member-a" }],
  ["pushSubscriptions/sub-a", { uid: "recipient", endpoint: "https://push.example/a", p256dh: "key-a", auth: "auth-a" }],
  ["pushSubscriptions/sub-other", { uid: "other", endpoint: "https://push.example/other", p256dh: "key-other", auth: "auth-other" }]
]);
assert.equal(await adapter.postAuthor({ path: "posts/post-a/comments/comment-a" }), "post-owner");
assert.deepEqual((await adapter.roomMembers({ data: { roomId: "room-a" } })).sort(), ["member-a", "member-b", "sender"]);
assert.equal(await adapter.recipientAvailable("post-owner"), true);
assert.equal(await adapter.recipientAvailable("missing-user"), false);
assert.deepEqual((await adapter.listSubscriptions("recipient")).map((subscription) => subscription.id), ["sub-a"]);

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
await adapter.failEvent(eventId, recovered.token, "DELIVERY_TRANSIENT");
assert.equal((await db.doc(`notificationEvents/${eventId}`).get()).data().errorCode, "DELIVERY_TRANSIENT");
const retry = await adapter.claimEvent(eventId, "worker-c");
await adapter.completeEvent(eventId, retry.token);
  const deliveredEvent = (await db.doc(`notificationEvents/${eventId}`).get()).data();
  assert.equal(deliveredEvent.status, "delivered");
  assert.equal(Object.hasOwn(deliveredEvent, "leaseToken"), false);
  assert.equal(Object.hasOwn(deliveredEvent, "errorCode"), false);
  assert.equal((await adapter.scanEventPage()).items.some((item) => item.id === eventId), false, "delivered retention records do not consume the active queue scan");

const subscriptionSnapshot = (await adapter.listSubscriptions("recipient"))[0];
await db.doc("pushSubscriptions/sub-a").update({ auth: "refreshed-auth" });
assert.equal(await adapter.deleteExpiredSubscription(subscriptionSnapshot), false, "a refreshed subscription is not deleted by a stale 410 response");
const refreshedSnapshot = (await adapter.listSubscriptions("recipient"))[0];
assert.equal(await adapter.deleteExpiredSubscription(refreshedSnapshot), true);
assert.equal((await db.doc("pushSubscriptions/sub-a").get()).exists, false);

await adapter.heartbeat("completed");
assert.equal((await db.doc("system/notificationProcessor").get()).data().status, "completed");
clock.now += NOTIFICATION_RETENTION_MS + 1;
const purged = await adapter.purgeDeliveredBefore(Timestamp.fromMillis(clock.now - NOTIFICATION_RETENTION_MS));
assert.equal(purged, 2, "the delivered event and its delivery marker are purged together");
assert.equal((await db.doc(`notificationEvents/${eventId}`).get()).exists, false);
assert.equal((await db.doc(`notificationDeliveries/${deliveryId}`).get()).exists, false);

await deleteApp(app);
console.log("Notification production Firestore integration passed");
