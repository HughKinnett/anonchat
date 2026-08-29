import assert from "node:assert/strict";
import {
  MAX_NOTIFICATION_AGE_MS,
  MAX_NOTIFICATION_ATTEMPTS,
  MAX_NOTIFICATION_EVENTS_PER_RUN,
  MAX_NOTIFICATION_MATERIALIZATIONS_PER_RUN,
  MAX_NOTIFICATION_RUNTIME_MS,
  MAX_NOTIFICATION_SENDS_PER_RUN,
  MAX_NOTIFICATION_SOURCES_PER_RUN,
  MAX_SUBSCRIPTIONS_PER_RECIPIENT,
  NOTIFICATION_RETRY_BASE_MS,
  NOTIFICATION_RETRY_MAX_MS,
  NOTIFICATION_RETENTION_MS,
  NOTIFICATION_TYPES,
  canonicalTimestamp,
  compareSourceCursors,
  createDeliveryId,
  createEventId,
  createSubscriptionVersionFingerprint,
  fixedNotificationErrorCode,
  isValidQueueEvent,
  notificationPayload,
  roomNotificationEligible,
  queuedEvent,
  retryDelayMs,
  shouldExhaustNotification,
  sourceCursor,
  validateTrustedSource
} from "../notification-policy.mjs";
import { Timestamp } from "firebase-admin/firestore";

const createdAt = { toMillis: () => 1_700_000_000_123 };
const later = { toMillis: () => 1_700_000_000_124 };
const preciseEarly = new Timestamp(1_700_000_000, 123_000_001);
const preciseLater = new Timestamp(1_700_000_000, 123_000_999);
assert.deepEqual([...NOTIFICATION_TYPES], ["reaction", "comment", "message-request", "room-message", "reveal-request"]);
assert.equal(MAX_SUBSCRIPTIONS_PER_RECIPIENT, 100);
assert.equal(MAX_NOTIFICATION_ATTEMPTS, 5);
assert.equal(MAX_NOTIFICATION_AGE_MS, 7 * 24 * 60 * 60 * 1000);
assert.equal(MAX_NOTIFICATION_EVENTS_PER_RUN, 100);
assert.equal(MAX_NOTIFICATION_SENDS_PER_RUN, 500);
assert.equal(MAX_NOTIFICATION_SOURCES_PER_RUN, 100);
assert.equal(MAX_NOTIFICATION_MATERIALIZATIONS_PER_RUN, 500);
assert.equal(MAX_NOTIFICATION_RUNTIME_MS, 4 * 60 * 1000);
assert.equal(retryDelayMs(1), NOTIFICATION_RETRY_BASE_MS);
assert.equal(retryDelayMs(2), NOTIFICATION_RETRY_BASE_MS * 2);
assert.equal(retryDelayMs(1_000), NOTIFICATION_RETRY_MAX_MS, "retry delay is bounded");
assert.deepEqual(canonicalTimestamp(preciseEarly), { seconds: 1_700_000_000, nanoseconds: 123_000_001 });
assert.deepEqual(canonicalTimestamp(new Date(1_700_000_000_123)), { seconds: 1_700_000_000, nanoseconds: 123_000_000 });
assert.deepEqual(canonicalTimestamp(1_700_000_000_123), { seconds: 1_700_000_000, nanoseconds: 123_000_000 });

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
assert.equal(compareSourceCursors({ createdAt: preciseLater, path: "a" }, { createdAt: preciseEarly, path: "z" }), 1,
  "nanoseconds precede full-path ordering even inside one millisecond");
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
const preciseEventId = await createEventId({ ...eventInput, sourceCreatedAt: preciseEarly });
assert.notEqual(await createEventId({ ...eventInput, sourceCreatedAt: preciseLater }), preciseEventId,
  "same-path source versions inside one millisecond cannot collide");

const subscriptionVersion = {
  uid: "recipient-a",
  endpoint: "https://push.example/a",
  expirationTime: null,
  p256dh: "p256dh-a",
  auth: "auth-a",
  createdAt: preciseEarly,
  updatedAt: preciseEarly
};
const subscriptionFingerprint = await createSubscriptionVersionFingerprint(subscriptionVersion);
assert.match(subscriptionFingerprint, /^[0-9a-f]{64}$/);
for (const changed of [
  { uid: "recipient-b" },
  { endpoint: "https://push.example/b" },
  { expirationTime: 123456 },
  { p256dh: "p256dh-b" },
  { auth: "auth-b" },
  { createdAt: preciseLater },
  { updatedAt: preciseLater }
]) {
  assert.notEqual(await createSubscriptionVersionFingerprint({ ...subscriptionVersion, ...changed }), subscriptionFingerprint,
    `subscription version change ${Object.keys(changed)[0]} changes its fingerprint`);
}
const deliveryId = await createDeliveryId(firstEventId, "subscription-a", subscriptionFingerprint);
assert.match(deliveryId, /^[0-9a-f]{64}$/);
assert.notEqual(await createDeliveryId(firstEventId, "subscription-b", subscriptionFingerprint), deliveryId);
const refreshedFingerprint = await createSubscriptionVersionFingerprint({ ...subscriptionVersion, updatedAt: preciseLater });
assert.notEqual(await createDeliveryId(firstEventId, "subscription-a", refreshedFingerprint), deliveryId,
  "old and refreshed versions use distinct delivery markers");

assert.equal(validateTrustedSource("reaction", { uid: "actor", createdAt }, 1_700_000_000_000), true);
assert.equal(validateTrustedSource("comment", { uid: "actor", createdAt }, 1_700_000_000_000), true);
assert.equal(validateTrustedSource("message-request", { fromId: "actor", toId: "recipient", status: "pending", createdAt }, 1_700_000_000_000), true);
assert.equal(validateTrustedSource("message-request", { fromId: "actor", toId: "recipient", status: "declined", createdAt }, 1_700_000_000_000), false);
assert.equal(validateTrustedSource("message-request", { fromId: "same", toId: "same", status: "pending", createdAt }, 1_700_000_000_000), false);
assert.equal(validateTrustedSource("room-message", { senderId: "actor", roomId: "room", createdAt, expiresAt: later }, 1_700_000_000_123), true);
assert.equal(validateTrustedSource("room-message", { senderId: "actor", roomId: "room", createdAt, expiresAt: createdAt }, 1_700_000_000_123), false);
assert.equal(validateTrustedSource("reveal-request", { fromId: "actor", toId: "recipient", status: "pending", createdAt }, 1_700_000_000_000), true);
assert.equal(validateTrustedSource("reaction", { uid: "", createdAt }, 1_700_000_000_000), false);
assert.equal(roomNotificationEligible({
  room: { moderationStatus: "active", expiresAt: later },
  actorUid: "actor",
  recipientUid: "recipient",
  blocked: false,
  nowMillis: 1_700_000_000_123
}), true);
for (const [label, candidate] of [
  ["missing parent", undefined],
  ["missing explicit status", { expiresAt: later }],
  ["reported parent", { moderationStatus: "reported", expiresAt: later }],
  ["expired parent", { moderationStatus: "active", expiresAt: createdAt }],
  ["malformed expiry", { moderationStatus: "active", expiresAt: "not-a-timestamp" }]
]) {
  assert.equal(roomNotificationEligible({
    room: candidate, actorUid: "actor", recipientUid: "recipient", blocked: false,
    nowMillis: 1_700_000_000_123
  }), false, label);
}
assert.equal(roomNotificationEligible({
  room: { moderationStatus: "active" }, actorUid: "actor", recipientUid: "recipient",
  blocked: true, nowMillis: 1_700_000_000_123
}), false, "either-direction blocking suppresses room delivery");

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
assert.equal(isValidQueueEvent({
  ...event,
  status: "failed",
  attempts: 1,
  errorCode: "DELIVERY_TRANSIENT",
  retryAt: later
}), true);
assert.equal(isValidQueueEvent({ ...event, status: "failed", attempts: 1, errorCode: "private error text" }), false);
assert.equal(isValidQueueEvent({ ...event, status: "suppressed", errorCode: "RECIPIENT_UNAVAILABLE" }), true);
assert.equal(isValidQueueEvent({
  ...event,
  status: "exhausted",
  attempts: MAX_NOTIFICATION_ATTEMPTS,
  errorCode: "DELIVERY_EXHAUSTED"
}), true);
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
const roomEvent = queuedEvent({
  type: "room-message", actorUid: "actor", recipientUid: "recipient", roomId: "room-a",
  sourceCreatedAt: createdAt, now: later, route: "/community.html#rooms-panel"
});
assert.equal(roomEvent.roomId, "room-a", "the internal queue retains only the parent identifier needed for revalidation");
assert.equal(isValidQueueEvent(roomEvent), true);
const { roomId: _roomId, ...roomEventWithoutRoomId } = roomEvent;
assert.equal(isValidQueueEvent(roomEventWithoutRoomId), false,
  "room events fail closed without a parent identifier");
assert.equal(isValidQueueEvent({ ...event, roomId: "room-a" }), false,
  "non-room events cannot smuggle a room identifier into the strict queue schema");
assert.equal(NOTIFICATION_RETENTION_MS, 30 * 24 * 60 * 60 * 1000);
assert.equal(shouldExhaustNotification({
  ...event,
  attempts: MAX_NOTIFICATION_ATTEMPTS,
  createdAt: createdAt
}, createdAt.toMillis()), true, "the maximum attempted event is terminal");
assert.equal(shouldExhaustNotification({
  ...event,
  attempts: 0,
  createdAt: createdAt
}, createdAt.toMillis() + MAX_NOTIFICATION_AGE_MS), true, "an over-age event is terminal");
assert.equal(shouldExhaustNotification({
  ...event,
  attempts: MAX_NOTIFICATION_ATTEMPTS - 1,
  createdAt: createdAt
}, createdAt.toMillis() + MAX_NOTIFICATION_AGE_MS - 1), false);
assert.equal(fixedNotificationErrorCode({ statusCode: 410 }), "SUBSCRIPTION_EXPIRED");
assert.equal(fixedNotificationErrorCode(Object.assign(new Error(), { code: "lease-lost" })), "LEASE_LOST");
assert.equal(fixedNotificationErrorCode(Object.assign(new Error(), { code: "INVALID_SUBSCRIPTION" })), "INVALID_SUBSCRIPTION");
assert.equal(fixedNotificationErrorCode(new Error("private uid and message body")), "DELIVERY_TRANSIENT");

console.log("Notification policy passed");
