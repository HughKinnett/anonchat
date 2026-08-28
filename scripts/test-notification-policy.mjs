import assert from "node:assert/strict";
import {
  NOTIFICATION_RETENTION_MS,
  NOTIFICATION_TYPES,
  compareSourceCursors,
  createDeliveryId,
  createEventId,
  fixedNotificationErrorCode,
  isValidQueueEvent,
  notificationPayload,
  queuedEvent,
  sourceCursor,
  validateTrustedSource
} from "../notification-policy.mjs";

const createdAt = { toMillis: () => 1_700_000_000_123 };
const later = { toMillis: () => 1_700_000_000_124 };
assert.deepEqual([...NOTIFICATION_TYPES], ["reaction", "comment", "message-request", "room-message", "reveal-request"]);

const expectedPayloads = {
  reaction: ["New reaction", "Someone reacted to your post.", "/timeline.html"],
  comment: ["New comment", "Someone commented on your post.", "/timeline.html"],
  "message-request": ["New message request", "You have a new private conversation request.", "/community.html#messages-panel"],
  "room-message": ["New room message", "A temporary room you joined has a new message.", "/community.html#rooms-panel"],
  "reveal-request": ["New mutual reveal request", "You have a new mutual reveal request.", "/community.html#messages-panel"]
};
for (const [type, [title, body, url]] of Object.entries(expectedPayloads)) {
  const payload = notificationPayload(type, "a".repeat(64));
  assert.deepEqual(payload, { type, title, body, url, tag: `anonchat-${"a".repeat(64)}` });
  assert.equal(JSON.stringify(payload).includes("private-uid"), false);
}
assert.throws(() => notificationPayload("arbitrary", "a".repeat(64)), /INVALID_NOTIFICATION_TYPE/);
assert.throws(() => notificationPayload("reaction", "short"), /INVALID_EVENT_ID/);

assert.deepEqual(sourceCursor({ path: "posts/p/comments/c", data: { createdAt } }), {
  createdAt,
  path: "posts/p/comments/c"
});
assert.equal(compareSourceCursors({ createdAt, path: "z" }, { createdAt, path: "z" }), 0);
assert.equal(compareSourceCursors({ createdAt, path: "a" }, { createdAt, path: "z" }), -1);
assert.equal(compareSourceCursors({ createdAt, path: "z" }, { createdAt, path: "ä" }), -1, "path ordering is deterministic and not locale dependent");
assert.equal(compareSourceCursors({ createdAt: later, path: "a" }, { createdAt, path: "z" }), 1);
assert.throws(() => sourceCursor({ path: "missing/time", data: {} }), /INVALID_SOURCE_TIMESTAMP/);

const eventInput = {
  type: "comment",
  sourcePath: "posts/post-a/comments/comment-a",
  sourceCreatedAt: createdAt,
  recipientUid: "recipient-a"
};
const firstEventId = await createEventId(eventInput);
assert.match(firstEventId, /^[0-9a-f]{64}$/);
assert.equal(await createEventId(eventInput), firstEventId);
assert.notEqual(await createEventId({ ...eventInput, sourcePath: "posts/post-a/comments/comment-b" }), firstEventId);
assert.notEqual(await createEventId({ ...eventInput, sourceCreatedAt: later }), firstEventId);
assert.notEqual(await createEventId({ ...eventInput, recipientUid: "recipient-b" }), firstEventId);
const deliveryId = await createDeliveryId(firstEventId, "subscription-a");
assert.match(deliveryId, /^[0-9a-f]{64}$/);
assert.notEqual(await createDeliveryId(firstEventId, "subscription-b"), deliveryId);

assert.equal(validateTrustedSource("reaction", { uid: "actor", createdAt }, 1_700_000_000_000), true);
assert.equal(validateTrustedSource("comment", { uid: "actor", createdAt }, 1_700_000_000_000), true);
assert.equal(validateTrustedSource("message-request", { fromId: "actor", toId: "recipient", status: "pending", createdAt }, 1_700_000_000_000), true);
assert.equal(validateTrustedSource("message-request", { fromId: "actor", toId: "recipient", status: "declined", createdAt }, 1_700_000_000_000), false);
assert.equal(validateTrustedSource("message-request", { fromId: "same", toId: "same", status: "pending", createdAt }, 1_700_000_000_000), false);
assert.equal(validateTrustedSource("room-message", { senderId: "actor", roomId: "room", createdAt, expiresAt: later }, 1_700_000_000_123), true);
assert.equal(validateTrustedSource("room-message", { senderId: "actor", roomId: "room", createdAt, expiresAt: createdAt }, 1_700_000_000_123), false);
assert.equal(validateTrustedSource("reveal-request", { fromId: "actor", toId: "recipient", status: "pending", createdAt }, 1_700_000_000_000), true);
assert.equal(validateTrustedSource("reaction", { uid: "", createdAt }, 1_700_000_000_000), false);

const event = queuedEvent({
  type: "comment", actorUid: "actor", recipientUid: "recipient", sourceCreatedAt: createdAt,
  now: later, route: "/timeline.html"
});
assert.deepEqual(Object.keys(event).sort(), [
  "actorUid", "attempts", "createdAt", "recipientUid", "route", "sourceCreatedAt", "status", "type", "updatedAt"
]);
assert.equal(event.status, "pending");
assert.equal(event.attempts, 0);
assert.equal(isValidQueueEvent(event), true);
assert.equal(isValidQueueEvent({ ...event, body: "private body" }), false);
assert.equal(isValidQueueEvent({ ...event, status: "processing" }), false);
assert.equal(isValidQueueEvent({ ...event, status: "failed", attempts: 1, errorCode: "DELIVERY_TRANSIENT" }), true);
assert.equal(isValidQueueEvent({ ...event, status: "failed", attempts: 1, errorCode: "private error text" }), false);
assert.equal(isValidQueueEvent({
  ...event,
  status: "processing",
  attempts: 1,
  leaseOwner: "worker",
  leaseToken: "token",
  leaseExpiresAt: later
}), true);
for (const forbidden of ["text", "body", "email", "username", "endpoint", "p256dh", "auth", "roomAlias", "sourcePath"]) {
  assert.equal(Object.hasOwn(event, forbidden), false, `${forbidden} is not copied into the queue`);
}
assert.equal(NOTIFICATION_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
assert.equal(fixedNotificationErrorCode({ statusCode: 410 }), "SUBSCRIPTION_EXPIRED");
assert.equal(fixedNotificationErrorCode(Object.assign(new Error(), { code: "lease-lost" })), "LEASE_LOST");
assert.equal(fixedNotificationErrorCode(new Error("private uid and message body")), "DELIVERY_TRANSIENT");

console.log("Notification policy passed");
