import assert from "node:assert/strict";
import { MAX_SUBSCRIPTIONS_PER_RECIPIENT, NOTIFICATION_LEASE_MS, notificationPayload } from "../notification-policy.mjs";
import { deliverNotificationEvents, scanTrustedNotificationSources } from "../notification-processor.mjs";

const time = (milliseconds) => ({ toMillis: () => milliseconds });
const document = (path, data, extra = {}) => ({ path, data, ...extra });

class ScanAdapter {
  constructor({ bootstrap = false } = {}) {
    this.bootstrap = bootstrap;
    this.scans = 0;
    this.events = new Map();
    this.cursors = new Map();
    this.pages = new Map();
    this.available = new Set(["post-owner", "request-to", "room-a", "room-b", "reveal-to"]);
  }
  now() { return 2_000; }
  timestamp(value) { return time(value); }
  async bootstrapSourceCursors() { return this.bootstrap; }
  async scanSourcePage(type, cursor) {
    this.scans += 1;
    const all = this.pages.get(type) || [];
    const start = cursor ? all.findIndex((item) => item.path === cursor.path) + 1 : 0;
    const items = all.slice(start, start + 2);
    return { items, nextCursor: items.at(-1) ? { createdAt: items.at(-1).data.createdAt, path: items.at(-1).path } : undefined };
  }
  async postAuthor(source) { return source.postAuthorUid; }
  async roomMembers(source) { return source.memberUids; }
  async recipientAvailable(uid) { return this.available.has(uid); }
  async createEvent(id, data) { if (!this.events.has(id)) this.events.set(id, { ...data }); }
  async advanceSourceCursor(type, cursor) { this.cursors.set(type, cursor); }
}

{
  const adapter = new ScanAdapter();
  adapter.pages.set("reaction", [
    document("posts/post-1/reactions/reaction-1", { uid: "reaction-actor", createdAt: time(10) }, { postAuthorUid: "post-owner" }),
    document("posts/post-2/reactions/reaction-self", { uid: "post-owner", createdAt: time(11) }, { postAuthorUid: "post-owner" }),
    document("posts/deleted/reactions/reaction-2", { uid: "actor", createdAt: time(12) })
  ]);
  adapter.pages.set("comment", [
    document("communityPosts/post-3/comments/comment-1", { uid: "comment-actor", text: "private comment body", username: "private_name", createdAt: time(13) }, { postAuthorUid: "post-owner" })
  ]);
  adapter.pages.set("message-request", [
    document("messageRequests/request-1", { fromId: "request-actor", toId: "request-to", status: "pending", createdAt: time(14) }),
    document("messageRequests/request-2", { fromId: "request-actor", toId: "request-to", status: "declined", createdAt: time(15) })
  ]);
  adapter.pages.set("room-message", [
    document("roomMessages/message-1", { senderId: "room-sender", roomId: "room-1", text: "private room body", tempName: "private alias", createdAt: time(16), expiresAt: time(3_000) }, { memberUids: ["room-sender", "room-a", "room-b", "room-a"] }),
    document("roomMessages/message-expired", { senderId: "room-sender", roomId: "room-1", createdAt: time(17), expiresAt: time(1_999) }, { memberUids: ["room-a"] })
  ]);
  adapter.pages.set("reveal-request", [
    document("reveals/reveal-1", { fromId: "reveal-actor", toId: "reveal-to", fields: { region: true }, status: "pending", createdAt: time(18) })
  ]);
  const result = await scanTrustedNotificationSources({ adapter });
  assert.deepEqual(result, { bootstrapped: false, scanned: 9, materialized: 6 });
  assert.equal(adapter.events.size, 6);
  assert.equal(adapter.scans > 5, true, "bounded source pagination reaches later pages");
  assert.equal(adapter.cursors.get("reaction").path, "posts/deleted/reactions/reaction-2");
  const queueJson = JSON.stringify([...adapter.events.values()]);
  for (const sensitive of ["private comment body", "private room body", "private_name", "private alias", "posts/post-1"]) {
    assert.equal(queueJson.includes(sensitive), false, `${sensitive} is absent from queue events`);
  }
  const roomEvents = [...adapter.events.values()].filter((event) => event.type === "room-message");
  assert.deepEqual(roomEvents.map((event) => event.recipientUid).sort(), ["room-a", "room-b"]);
}

{
  const adapter = new ScanAdapter({ bootstrap: true });
  adapter.pages.set("reaction", [document("posts/old/reactions/old", { uid: "actor", createdAt: time(1) }, { postAuthorUid: "post-owner" })]);
  assert.deepEqual(await scanTrustedNotificationSources({ adapter }), { bootstrapped: true, scanned: 0, materialized: 0 });
  assert.equal(adapter.scans, 0, "first run sends no historical notifications");
  assert.equal(adapter.events.size, 0);
}

class DeliveryAdapter {
  constructor(events, subscriptions = new Map()) {
    this.clock = 10_000;
    this.events = new Map(events.map((event) => [event.id, { ...event.data }]));
    this.subscriptions = subscriptions;
    this.deliveries = new Map();
    this.expired = [];
    this.logs = [];
    this.claimed = new Set();
    this.throwAfterSend = false;
    this.renewals = 0;
    this.expirationMutation = undefined;
    this.recreateAfterExpiration = undefined;
    this.advanceBeforeList = 0;
    this.trace = [];
  }
  now() { return this.clock; }
  timestamp(value) { return time(value); }
  async scanEventPage(cursor) {
    const entries = [...this.events].filter(([, event]) => ["pending", "failed", "processing"].includes(event.status)).sort(([a], [b]) => a.localeCompare(b));
    const selected = entries.filter(([id]) => !cursor || id > cursor).slice(0, 2);
    return { items: selected.map(([id, data]) => ({ id, data: { ...data } })), nextCursor: selected.at(-1)?.[0] };
  }
  async claimEvent(id, owner) {
    const event = this.events.get(id);
    if (!event || (event.status === "processing" && event.leaseExpiresAt.toMillis() > this.clock)) return null;
    const token = `${owner}-${id}`;
    Object.assign(event, { status: "processing", attempts: event.attempts + 1, leaseToken: token, leaseExpiresAt: time(this.clock + NOTIFICATION_LEASE_MS) });
    this.claimed.add(id);
    return { id, token, data: { ...event } };
  }
  async listSubscriptions(uid) {
    this.clock += this.advanceBeforeList;
    this.advanceBeforeList = 0;
    return (this.subscriptions.get(uid) || []).map((entry) => ({ ...entry }));
  }
  async renewEvent(id, token) {
    assert.equal(this.events.get(id).leaseToken, token);
    assert.equal(this.events.get(id).leaseExpiresAt.toMillis() > this.clock, true);
    this.events.get(id).leaseExpiresAt = time(this.clock + NOTIFICATION_LEASE_MS);
    this.renewals += 1;
    this.trace.push("renew");
  }
  async getDelivery(id) { return this.deliveries.get(id); }
  async markDelivery(id, data) { if (this.throwAfterSend) { this.throwAfterSend = false; throw new Error("simulated crash"); } this.deliveries.set(id, data); }
  async expireSubscriptionVersion(subscription, deliveryId, data) {
    const entries = this.subscriptions.get(subscription.uid) || [];
    if (this.expirationMutation) {
      this.expirationMutation(entries, subscription);
      this.expirationMutation = undefined;
    }
    const currentIndex = entries.findIndex((entry) => entry.id === subscription.id);
    if (currentIndex < 0 || subscriptionVersion(entries[currentIndex]) !== subscriptionVersion(subscription)) return false;
    entries.splice(currentIndex, 1);
    this.deliveries.set(deliveryId, data);
    this.expired.push(subscription.id);
    if (this.recreateAfterExpiration) {
      entries.push({ ...subscription, ...this.recreateAfterExpiration });
      this.recreateAfterExpiration = undefined;
    }
    return true;
  }
  async completeEvent(id, token) { assert.equal(this.events.get(id).leaseToken, token); Object.assign(this.events.get(id), { status: "delivered", updatedAt: time(this.clock) }); this.claimed.delete(id); }
  async failEvent(id, token, errorCode) { assert.equal(this.events.get(id).leaseToken, token); Object.assign(this.events.get(id), { status: "failed", errorCode, updatedAt: time(this.clock) }); this.claimed.delete(id); }
  async purgeDeliveredBefore() { return 2; }
}

const subscriptionVersion = (value) => JSON.stringify([
  value.uid,
  value.endpoint,
  value.expirationTime,
  value.p256dh,
  value.auth,
  value.createdAt?.seconds ?? Math.floor(value.createdAt?.toMillis?.() / 1000),
  value.createdAt?.nanoseconds ?? ((value.createdAt?.toMillis?.() % 1000) * 1_000_000),
  value.updatedAt?.seconds ?? Math.floor(value.updatedAt?.toMillis?.() / 1000),
  value.updatedAt?.nanoseconds ?? ((value.updatedAt?.toMillis?.() % 1000) * 1_000_000)
]);
const subscription = (uid, idValue, overrides = {}) => ({
  id: idValue,
  uid,
  endpoint: `https://push.example/${idValue}`,
  expirationTime: null,
  p256dh: `key-${idValue}`,
  auth: `auth-${idValue}`,
  createdAt: time(100),
  updatedAt: time(100),
  ...overrides
});

const queued = (id, type, recipientUid) => ({
  id,
  data: { type, actorUid: "actor", recipientUid, route: notificationPayload(type, id).url, sourceCreatedAt: time(1), status: "pending", attempts: 0, createdAt: time(1), updatedAt: time(1) }
});
const id = (digit) => digit.repeat(64);

{
  const events = [queued(id("a"), "reaction", "multi"), queued(id("b"), "comment", "none"), queued(id("c"), "reveal-request", "expired")];
  const subscriptions = new Map([
    ["multi", [subscription("multi", "device-one"), subscription("multi", "device-two")]],
    ["expired", [subscription("expired", "expired-device")]]
  ]);
  const adapter = new DeliveryAdapter(events, subscriptions);
  const attempts = [];
  let secondDeviceFails = true;
  const sendPush = async (subscription, payload) => {
    attempts.push([subscription.id, payload]);
    if (subscription.id === "device-two" && secondDeviceFails) throw Object.assign(new Error("transient private detail"), { statusCode: 503 });
    if (subscription.id === "expired-device") throw Object.assign(new Error("gone"), { statusCode: 410 });
  };
  const logs = [];
  const first = await deliverNotificationEvents({ adapter, ownerId: "worker-a", sendPush, logger: { info: (code) => logs.push(code), error: (code) => logs.push(code) } });
  assert.equal(first.delivered, 2, "no-subscription and expired-only events complete");
  assert.equal(first.retried, 1);
  assert.deepEqual(adapter.expired, ["expired-device"]);
  assert.equal(adapter.events.get(id("a")).status, "failed");
  assert.equal(adapter.events.get(id("b")).status, "delivered");
  assert.equal(adapter.events.get(id("c")).status, "delivered");
  assert.equal(attempts.filter(([device]) => device === "device-one").length, 1);
  assert.equal(adapter.renewals >= attempts.length * 2, true, "the event lease is renewed immediately before and after every bounded send");

  secondDeviceFails = false;
  const second = await deliverNotificationEvents({ adapter, ownerId: "worker-b", sendPush, logger: { info: (code) => logs.push(code), error: (code) => logs.push(code) } });
  assert.equal(second.delivered, 1);
  assert.equal(attempts.filter(([device]) => device === "device-one").length, 1, "successful device marker skips resend");
  assert.equal(attempts.filter(([device]) => device === "device-two").length, 2);
  assert.ok(logs.every((entry) => /^[A-Z0-9_]+(?: [a-z]+=[0-9]+)*$/.test(entry)), "logs contain fixed codes and aggregate counts only");
  assert.equal(logs.join(" ").includes("multi"), false);
  assert.equal(logs.join(" ").includes("private"), false);
}

{
  const event = queued(id("d"), "room-message", "crash-user");
  const adapter = new DeliveryAdapter([event], new Map([["crash-user", [subscription("crash-user", "crash-device")]]]));
  const tags = [];
  const sendPush = async (_subscription, payload) => tags.push(payload.tag);
  adapter.throwAfterSend = true;
  await deliverNotificationEvents({ adapter, ownerId: "worker-a", sendPush, logger: { info() {}, error() {} } });
  assert.equal(adapter.events.get(id("d")).status, "failed");
  await deliverNotificationEvents({ adapter, ownerId: "worker-b", sendPush, logger: { info() {}, error() {} } });
  assert.deepEqual(tags, [`anonchat-${id("d")}`, `anonchat-${id("d")}`], "crash retry keeps the stable collapse tag");
}

{
  const event = queued(id("e"), "message-request", "lease-user");
  event.data.status = "processing";
  event.data.leaseExpiresAt = time(20_000);
  const adapter = new DeliveryAdapter([event]);
  const result = await deliverNotificationEvents({ adapter, ownerId: "overlap", sendPush: async () => {}, logger: { info() {}, error() {} } });
  assert.equal(result.skipped, 1, "overlapping worker cannot claim an active lease");
}

{
  const event = queued(id("f"), "reaction", "refresh-user");
  const adapter = new DeliveryAdapter([event], new Map([["refresh-user", [subscription("refresh-user", "refresh-device")]]]));
  adapter.expirationMutation = (entries) => { entries[0].updatedAt = time(101); };
  let expiredResponse = true;
  const sendPush = async () => {
    if (expiredResponse) throw Object.assign(new Error("gone"), { statusCode: 410 });
  };
  const first = await deliverNotificationEvents({ adapter, ownerId: "worker-a", sendPush, logger: { info() {}, error() {} } });
  assert.equal(first.retried, 1, "a subscription refreshed during a 410 response keeps the event retryable");
  assert.equal(adapter.events.get(id("f")).status, "failed");
  assert.equal(adapter.deliveries.size, 0);
  expiredResponse = false;
  const second = await deliverNotificationEvents({ adapter, ownerId: "worker-b", sendPush, logger: { info() {}, error() {} } });
  assert.equal(second.delivered, 1);
}

for (const [label, mutate] of [
  ["expiration-only refresh", (entry) => { entry.expirationTime = 123456; }],
  ["delete and recreate before expiration commit", (entry) => Object.assign(entry, { auth: "recreated-auth", createdAt: time(102), updatedAt: time(102) })]
]) {
  const event = queued(id(label === "expiration-only refresh" ? "1" : "2"), "reaction", "version-race");
  const adapter = new DeliveryAdapter([event], new Map([["version-race", [subscription("version-race", "version-device")]]]));
  adapter.expirationMutation = (entries) => mutate(entries[0]);
  const result = await deliverNotificationEvents({
    adapter,
    ownerId: "worker-version",
    sendPush: async () => { throw Object.assign(new Error("gone"), { statusCode: 410 }); },
    logger: { info() {}, error() {} }
  });
  assert.equal(result.retried, 1, `${label} remains retryable`);
  assert.equal(adapter.events.get(event.id).status, "failed");
  assert.equal(adapter.deliveries.size, 0, `${label} cannot create a stale expired marker`);
}

{
  const event = queued(id("3"), "reaction", "recreate-user");
  const adapter = new DeliveryAdapter([event], new Map([["recreate-user", [subscription("recreate-user", "recreate-device")]]]));
  adapter.recreateAfterExpiration = { auth: "new-auth", createdAt: time(103), updatedAt: time(103) };
  let gone = true;
  const attempts = [];
  const sendPush = async (current) => {
    attempts.push(current.auth);
    if (gone) throw Object.assign(new Error("gone"), { statusCode: 410 });
  };
  const first = await deliverNotificationEvents({ adapter, ownerId: "worker-old", sendPush, logger: { info() {}, error() {} } });
  assert.equal(first.retried, 1, "a version recreated after atomic expiration is found by the completion relist");
  assert.equal(adapter.events.get(event.id).status, "failed");
  assert.equal(adapter.deliveries.size, 1, "the exact old version has one expired marker");
  gone = false;
  const second = await deliverNotificationEvents({ adapter, ownerId: "worker-new", sendPush, logger: { info() {}, error() {} } });
  assert.equal(second.delivered, 1);
  assert.deepEqual(attempts, ["auth-recreate-device", "new-auth"]);
  assert.equal(adapter.deliveries.size, 2, "old and recreated versions have separate delivery markers");
}

{
  const event100 = queued(id("4"), "comment", "hundred-user");
  const subscriptions100 = Array.from({ length: MAX_SUBSCRIPTIONS_PER_RECIPIENT }, (_, index) => subscription("hundred-user", `device-${index}`));
  const adapter100 = new DeliveryAdapter([event100], new Map([["hundred-user", subscriptions100]]));
  let sends100 = 0;
  const allowed = await deliverNotificationEvents({
    adapter: adapter100,
    ownerId: "worker-100",
    sendPush: async () => { sends100 += 1; },
    logger: { info() {}, error() {} }
  });
  assert.equal(allowed.delivered, 1);
  assert.equal(sends100, 100, "exactly 100 current subscription versions are allowed");

  const event101 = queued(id("5"), "comment", "overflow-user");
  const subscriptions101 = Array.from({ length: MAX_SUBSCRIPTIONS_PER_RECIPIENT + 1 }, (_, index) => subscription("overflow-user", `overflow-${index}`));
  const adapter101 = new DeliveryAdapter([event101], new Map([["overflow-user", subscriptions101]]));
  const logs = [];
  let sends101 = 0;
  const blocked = await deliverNotificationEvents({
    adapter: adapter101,
    ownerId: "worker-101",
    sendPush: async () => { sends101 += 1; },
    logger: { info: (code) => logs.push(code), error: (code) => logs.push(code) }
  });
  assert.equal(blocked.retried, 1);
  assert.equal(sends101, 0, "101 subscriptions fail closed before any send");
  assert.equal(adapter101.events.get(event101.id).errorCode, "SUBSCRIPTION_LIMIT");
  assert.equal(logs.includes("SUBSCRIPTION_LIMIT"), true, "overflow logs use only the fixed code");
  assert.equal(logs.join(" ").includes("overflow-user"), false);
}

{
  const event = queued(id("6"), "room-message", "lease-send-user");
  const adapter = new DeliveryAdapter([event], new Map([["lease-send-user", [subscription("lease-send-user", "lease-device")]]]));
  adapter.advanceBeforeList = NOTIFICATION_LEASE_MS - 1;
  const result = await deliverNotificationEvents({
    adapter,
    ownerId: "live-worker",
    sendPush: async () => {
      adapter.trace.push("send-start");
      adapter.clock += 29_999;
      assert.equal(await adapter.claimEvent(event.id, "overlap-worker"), null,
        "a renewed lease cannot be claimed while a near-timeout request is live");
      adapter.trace.push("send-end");
    },
    logger: { info() {}, error() {} }
  });
  assert.equal(result.delivered, 1);
  assert.deepEqual(adapter.trace.slice(0, 4), ["renew", "send-start", "send-end", "renew"],
    "each send is immediately bracketed by lease renewals");
}

{
  const event = queued(id("7"), "comment", "timeout-user");
  const adapter = new DeliveryAdapter([event], new Map([["timeout-user", [subscription("timeout-user", "timeout-device")]]]));
  const logs = [];
  const result = await deliverNotificationEvents({
    adapter,
    ownerId: "timeout-worker",
    sendPush: async () => { throw Object.assign(new Error("Socket timeout"), { code: "ETIMEDOUT" }); },
    logger: { info: (code) => logs.push(code), error: (code) => logs.push(code) }
  });
  assert.equal(result.retried, 1);
  assert.equal(adapter.events.get(event.id).errorCode, "DELIVERY_TRANSIENT",
    "a timed-out Web Push request fails closed for retry");
  assert.equal(adapter.deliveries.size, 0);
  assert.equal(logs.includes("DELIVERY_TRANSIENT"), true);
  assert.equal(logs.join(" ").includes("Socket timeout"), false);
}

console.log("Notification processor behavior passed");
