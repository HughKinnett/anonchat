export const NOTIFICATION_TYPES = Object.freeze([
  "reaction",
  "comment",
  "message-request",
  "room-message",
  "reveal-request"
]);
export const NOTIFICATION_PAGE_LIMIT = 100;
export const NOTIFICATION_LEASE_MS = 5 * 60 * 1000;
export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const ACCOUNT_LIMIT = 500;

const TYPE_SET = new Set(NOTIFICATION_TYPES);
const PAYLOADS = Object.freeze({
  reaction: Object.freeze({ title: "New reaction", body: "Someone reacted to your post.", url: "/timeline.html" }),
  comment: Object.freeze({ title: "New comment", body: "Someone commented on your post.", url: "/timeline.html" }),
  "message-request": Object.freeze({ title: "New message request", body: "You have a new private conversation request.", url: "/community.html#messages-panel" }),
  "room-message": Object.freeze({ title: "New room message", body: "A temporary room you joined has a new message.", url: "/community.html#rooms-panel" }),
  "reveal-request": Object.freeze({ title: "New mutual reveal request", body: "You have a new mutual reveal request.", url: "/community.html#messages-panel" })
});

export const timestampMillis = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  return Number.NaN;
};

const nonempty = (value) => typeof value === "string" && value.length > 0;
const exactKeys = (value, keys) => value && typeof value === "object"
  && Object.keys(value).sort().join("\u0000") === [...keys].sort().join("\u0000");
const codedError = (code) => Object.assign(new Error(code), { code });
const sha256 = async (value, subtle = globalThis.crypto?.subtle) => {
  if (!subtle) throw codedError("HASH_UNAVAILABLE");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const notificationPayload = (type, eventId) => {
  if (!TYPE_SET.has(type)) throw codedError("INVALID_NOTIFICATION_TYPE");
  if (!/^[0-9a-f]{64}$/.test(eventId)) throw codedError("INVALID_EVENT_ID");
  return { type, ...PAYLOADS[type], tag: `anonchat-${eventId}` };
};

export const sourceCursor = (source) => {
  const createdAt = source?.data?.createdAt;
  if (!Number.isFinite(timestampMillis(createdAt))) throw codedError("INVALID_SOURCE_TIMESTAMP");
  if (!nonempty(source?.path)) throw codedError("INVALID_SOURCE_PATH");
  return { createdAt, path: source.path };
};

export const compareSourceCursors = (left, right) => {
  const timeDifference = timestampMillis(left?.createdAt) - timestampMillis(right?.createdAt);
  if (timeDifference !== 0) return timeDifference < 0 ? -1 : 1;
  const leftPath = String(left?.path ?? "");
  const rightPath = String(right?.path ?? "");
  return leftPath === rightPath ? 0 : leftPath < rightPath ? -1 : 1;
};

export const createEventId = ({ type, sourcePath, sourceCreatedAt, recipientUid }, subtle) => {
  if (!TYPE_SET.has(type) || !nonempty(sourcePath) || !nonempty(recipientUid)
    || !Number.isFinite(timestampMillis(sourceCreatedAt))) throw codedError("INVALID_EVENT_INPUT");
  return sha256(JSON.stringify([type, sourcePath, timestampMillis(sourceCreatedAt), recipientUid]), subtle);
};

export const createDeliveryId = (eventId, subscriptionId, subtle) => {
  if (!/^[0-9a-f]{64}$/.test(eventId) || !nonempty(subscriptionId)) throw codedError("INVALID_DELIVERY_INPUT");
  return sha256(JSON.stringify([eventId, subscriptionId]), subtle);
};

export const validateTrustedSource = (type, data, nowMillis) => {
  if (!TYPE_SET.has(type) || !Number.isFinite(timestampMillis(data?.createdAt))) return false;
  if (["reaction", "comment"].includes(type)) return nonempty(data.uid);
  if (["message-request", "reveal-request"].includes(type)) {
    return nonempty(data.fromId) && nonempty(data.toId) && data.fromId !== data.toId && data.status === "pending";
  }
  return nonempty(data.senderId) && nonempty(data.roomId)
    && Number.isFinite(timestampMillis(data.expiresAt)) && timestampMillis(data.expiresAt) > nowMillis;
};

export const queuedEvent = ({ type, actorUid, recipientUid, route, sourceCreatedAt, now }) => {
  if (!TYPE_SET.has(type) || !nonempty(actorUid) || !nonempty(recipientUid) || actorUid === recipientUid
    || PAYLOADS[type].url !== route || !Number.isFinite(timestampMillis(sourceCreatedAt))
    || !Number.isFinite(timestampMillis(now))) throw codedError("INVALID_EVENT_INPUT");
  return {
    type,
    actorUid,
    recipientUid,
    route,
    sourceCreatedAt,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now
  };
};

export const isValidQueueEvent = (event) => {
  const baseKeys = ["type", "actorUid", "recipientUid", "route", "sourceCreatedAt", "status", "attempts", "createdAt", "updatedAt"];
  const keys = event?.status === "processing"
    ? [...baseKeys, "leaseOwner", "leaseToken", "leaseExpiresAt"]
    : event?.status === "failed"
      ? [...baseKeys, "errorCode"]
      : baseKeys;
  if (!exactKeys(event, keys) || !TYPE_SET.has(event.type) || PAYLOADS[event.type].url !== event.route
    || !nonempty(event.actorUid) || !nonempty(event.recipientUid) || event.actorUid === event.recipientUid
    || !Number.isInteger(event.attempts) || event.attempts < 0
    || !["pending", "processing", "failed", "delivered"].includes(event.status)
    || !Number.isFinite(timestampMillis(event.sourceCreatedAt))
    || !Number.isFinite(timestampMillis(event.createdAt))
    || !Number.isFinite(timestampMillis(event.updatedAt))) return false;
  if (event.status === "processing") return event.attempts >= 1 && nonempty(event.leaseOwner)
    && nonempty(event.leaseToken) && Number.isFinite(timestampMillis(event.leaseExpiresAt));
  if (event.status === "failed") return event.attempts >= 1 && /^[A-Z0-9_]+$/.test(event.errorCode);
  return true;
};

export const fixedNotificationErrorCode = (error) => {
  if ([404, 410].includes(error?.statusCode)) return "SUBSCRIPTION_EXPIRED";
  if (error?.code === "lease-lost") return "LEASE_LOST";
  if (error?.code === "invalid-event") return "INVALID_EVENT";
  if (error?.code === "invalid-subscription") return "INVALID_SUBSCRIPTION";
  if (error?.code === "cursor-limit") return "CURSOR_LIMIT";
  return "DELIVERY_TRANSIENT";
};

export const notificationRoute = (type) => PAYLOADS[type]?.url;
