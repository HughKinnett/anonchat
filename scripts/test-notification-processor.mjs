import assert from "node:assert/strict";
import {
  MAX_NOTIFICATION_RUNTIME_MS,
  MAX_SUBSCRIPTIONS_PER_RECIPIENT,
  NOTIFICATION_LEASE_MS,
  NOTIFICATION_TYPES,
  notificationPayload
} from "../notification-policy.mjs";
import {
  deliverNotificationEvents,
  runNotificationProcessor,
  scanTrustedNotificationSources
} from "../notification-processor.mjs";

const time = (milliseconds) => ({ toMillis: () => milliseconds });
const document = (path, data, extra = {}) => ({ path, data, ...extra });

class ScanAdapter {
  constructor({ bootstrap = false } = {}) {
    this.bootstrap = bootstrap;
    this.scans = 0;
    this.events = new Map();
    this.cursors = new Map();
    this.pages = new Map();
    this.nextSourceType = "reaction";
    this.available = new Set(["post-owner", "request-to", "room-a", "room-b", "reveal-to"]);
    this.blockedPairs = new Set();
    this.blockBatchChecks = 0;
  }
  now() { return 2_000; }
  timestamp(value) { return time(value); }
  async bootstrapSourceCursors() { return this.bootstrap; }
  async sourcePriority() { return this.nextSourceType; }
  async prioritizeSourceType(type) { this.nextSourceType = type; }
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
  async unblockedRecipients(actorUid, recipientUids) {
    this.blockBatchChecks += 1;
    return recipientUids.filter((recipientUid) =>
      !this.blockedPairs.has([actorUid, recipientUid].sort().join("/"))
    );
  }
  async createEvent(id, data) {
    if (this.events.has(id)) return false;
    this.events.set(id, { ...data });
    return true;
  }
  async createEvents(entries) {
    let created = 0;
    for (const [id, data] of entries) created += await this.createEvent(id, data) ? 1 : 0;
    return created;
  }
  async advanceSourceCursor(type, cursor, nextSourceType) {
    this.cursors.set(type, cursor);
    if (nextSourceType) this.nextSourceType = nextSourceType;
  }
}

{
  const adapter = new ScanAdapter();
  adapter.pages.set("reaction", [
    document("posts/blocked/reactions/blocked", { uid: "reaction-actor", createdAt: time(20) }, { postAuthorUid: "post-owner" })
  ]);
  adapter.blockedPairs.add("post-owner/reaction-actor");
  const result = await scanTrustedNotificationSources({ adapter });
  assert.equal(result.materialized, 0, "blocked pairs are suppressed before event materialization");
  assert.equal(adapter.blockBatchChecks, 1, "one bounded block snapshot is read for the candidate batch");
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
    this.availabilitySequence = [];
    this.blockedPairs = new Set();
    this.blockChecks = 0;
    this.blockSequence = [];
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
  async recipientAvailable() {
    this.trace.push("availability");
    return this.availabilitySequence.length ? this.availabilitySequence.shift() : true;
  }
  async pairBlocked(left, right) {
    this.blockChecks += 1;
    if (this.blockSequence.length) return this.blockSequence.shift();
    return this.blockedPairs.has([left, right].sort().join("/"));
  }
  async unblockedRecipients(actorUid, recipientUids) {
    return recipientUids.filter((recipientUid) =>
      !this.blockedPairs.has([actorUid, recipientUid].sort().join("/"))
    );
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
  async failEvent(id, token, errorCode) { assert.equal(this.events.get(id).leaseToken, token); Object.assign(this.events.get(id), { status: "failed", errorCode, updatedAt: time(this.clock) }); this.claimed.delete(id); return "failed"; }
  async suppressEvent(id, token, errorCode = "RECIPIENT_UNAVAILABLE") { assert.equal(this.events.get(id).leaseToken, token); Object.assign(this.events.get(id), { status: "suppressed", errorCode, updatedAt: time(this.clock) }); this.claimed.delete(id); }
  async deferEvent(id, token) {
    const event = this.events.get(id);
    assert.equal(event.leaseToken, token);
    Object.assign(event, { status: "pending", attempts: event.attempts - 1, updatedAt: time(this.clock) });
    delete event.leaseToken;
    delete event.leaseExpiresAt;
    this.claimed.delete(id);
  }
  async purgeTerminalBefore() { return 2; }
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
  const event = queued(id("0"), "comment", "blocked-recipient");
  const adapter = new DeliveryAdapter([event], new Map([
    ["blocked-recipient", [subscription("blocked-recipient", "blocked-device")]]
  ]));
  adapter.blockedPairs.add("actor/blocked-recipient");
  let sends = 0;
  const result = await deliverNotificationEvents({
    adapter,
    ownerId: "worker",
    sendPush: async () => { sends += 1; },
    logger: { info() {}, error() {} }
  });
  assert.equal(sends, 0, "a block created before delivery prevents push transmission");
  assert.equal(result.suppressed, 1);
  assert.equal(adapter.events.get(event.id).errorCode, "BLOCKED_PAIR");
  assert.equal(adapter.blockChecks, 1, "delivery uses a bounded direct pair check");
}

{
  const event = queued(id("9"), "comment", "mid-block-recipient");
  const adapter = new DeliveryAdapter([event], new Map([
    ["mid-block-recipient", [
      subscription("mid-block-recipient", "first-device"),
      subscription("mid-block-recipient", "second-device")
    ]]
  ]));
  adapter.blockSequence = [false, true];
  const sent = [];
  const result = await deliverNotificationEvents({
    adapter,
    ownerId: "worker",
    sendPush: async (entry) => sent.push(entry.id),
    logger: { info() {}, error() {} }
  });
  assert.deepEqual(sent, ["first-device"], "a mid-delivery block prevents every later unsent subscription");
  assert.equal(result.suppressed, 1);
  assert.equal(adapter.events.get(event.id).errorCode, "BLOCKED_PAIR");
}

{
  const event = queued(id("8"), "reaction", "completion-block-recipient");
  const adapter = new DeliveryAdapter([event], new Map([
    ["completion-block-recipient", [subscription("completion-block-recipient", "only-device")]]
  ]));
  adapter.blockSequence = [false, true];
  const sent = [];
  const result = await deliverNotificationEvents({
    adapter,
    ownerId: "worker",
    sendPush: async (entry) => sent.push(entry.id),
    logger: { info() {}, error() {} }
  });
  assert.deepEqual(sent, ["only-device"]);
  assert.equal(result.suppressed, 1,
    "a block after the last send but before completion prevents event completion");
  assert.equal(adapter.events.get(event.id).errorCode, "BLOCKED_PAIR");
}

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
  adapter.advanceBeforeList = MAX_NOTIFICATION_RUNTIME_MS - 30_001;
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
  assert.deepEqual(
    adapter.trace.slice(0, 6),
    ["availability", "renew", "availability", "send-start", "send-end", "renew"],
    "recipient availability is rechecked and each send is immediately bracketed by lease renewals"
  );
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

for (const [state, availabilitySequence, eventDigit] of [
  ["missing-after-claim", [false], "a"],
  ["banned-before-send", [true, false], "b"],
  ["admin-deleting-before-send", [true, false], "c"],
  ["self-deleting-before-send", [true, false], "d"]
]) {
  const event = queued(id(eventDigit), "reaction", state);
  const adapter = new DeliveryAdapter([event], new Map([[state, [subscription(state, `${state}-device`)]]]));
  adapter.availabilitySequence = [...availabilitySequence];
  let sends = 0;
  const result = await deliverNotificationEvents({
    adapter,
    ownerId: `worker-${state}`,
    sendPush: async () => { sends += 1; },
    logger: { info() {}, error() {} }
  });
  assert.equal(sends, 0, `${state} is terminally suppressed before external delivery`);
  assert.equal(adapter.events.get(event.id).status, "suppressed");
  assert.equal(adapter.events.get(event.id).errorCode, "RECIPIENT_UNAVAILABLE");
  assert.equal(result.suppressed, 1);
}

{
  const event = queued(id("8"), "comment", "budget-user");
  const devices = [
    subscription("budget-user", "budget-one"),
    subscription("budget-user", "budget-two"),
    subscription("budget-user", "budget-three")
  ];
  const adapter = new DeliveryAdapter([event], new Map([["budget-user", devices]]));
  const sent = [];
  for (let run = 0; run < 3; run += 1) {
    const result = await deliverNotificationEvents({
      adapter,
      ownerId: `budget-worker-${run}`,
      sendPush: async (current) => sent.push(current.id),
      logger: { info() {}, error() {} },
      limits: { maxEvents: 10, maxSends: 1, maxRuntimeMs: 60_000 }
    });
    assert.ok(result.sent <= 1, "each invocation respects the external-send budget");
  }
  assert.deepEqual(sent, ["budget-one", "budget-two", "budget-three"],
    "delivery markers resume a budget-deferred event without duplicate sends");
  assert.equal(adapter.events.get(event.id).status, "delivered");
}

{
  const events = [
    queued(id("1"), "comment", "event-one"),
    queued(id("2"), "comment", "event-two")
  ];
  const adapter = new DeliveryAdapter(events);
  const first = await deliverNotificationEvents({
    adapter,
    ownerId: "event-worker-one",
    sendPush: async () => {},
    logger: { info() {}, error() {} },
    limits: { maxEvents: 1, maxSends: 10, maxRuntimeMs: 60_000 }
  });
  assert.equal(first.inspected, 1, "the event budget bounds each invocation");
  assert.equal(first.budgetReached, true);
  assert.equal([...adapter.events.values()].filter((event) => event.status === "pending").length, 1);
  await deliverNotificationEvents({
    adapter,
    ownerId: "event-worker-two",
    sendPush: async () => {},
    logger: { info() {}, error() {} },
    limits: { maxEvents: 1, maxSends: 10, maxRuntimeMs: 60_000 }
  });
  assert.equal([...adapter.events.values()].every((event) => event.status === "delivered"), true,
    "a later invocation resumes after the event budget");
}

{
  const events = [
    queued(id("9"), "reaction", "time-one"),
    queued(id("0"), "reaction", "time-two")
  ];
  const adapter = new DeliveryAdapter(events, new Map([
    ["time-one", [subscription("time-one", "time-one-device")]],
    ["time-two", [subscription("time-two", "time-two-device")]]
  ]));
  const sent = [];
  const first = await deliverNotificationEvents({
    adapter,
    ownerId: "time-worker-one",
    sendPush: async (current) => {
      sent.push(current.id);
      adapter.clock += 100;
    },
    logger: { info() {}, error() {} },
    limits: { maxEvents: 10, maxSends: 10, maxRuntimeMs: 100 }
  });
  assert.equal(first.budgetReached, true);
  assert.equal(sent.length, 1, "the runtime budget stops later event work");
  await deliverNotificationEvents({
    adapter,
    ownerId: "time-worker-two",
    sendPush: async (current) => sent.push(current.id),
    logger: { info() {}, error() {} },
    limits: { maxEvents: 10, maxSends: 10, maxRuntimeMs: 100 }
  });
  assert.equal(sent.length, 2, "a later invocation resumes after the runtime budget");
}

class RunBudgetAdapter extends DeliveryAdapter {
  constructor(sourceCount, { advanceAfterMaterialization = 0 } = {}) {
    super([]);
    this.advanceAfterMaterialization = advanceAfterMaterialization;
    this.sourceCursors = new Map();
    this.nextSourceType = "reaction";
    this.sourceItems = Array.from({ length: sourceCount }, (_, index) => document(
      `posts/source-${index}/reactions/reaction-${index}`,
      { uid: `actor-${index}`, createdAt: time(index + 1) },
      { postAuthorUid: `recipient-${index}` }
    ));
    this.heartbeats = [];
  }
  async bootstrapSourceCursors() { return false; }
  async sourcePriority() { return this.nextSourceType; }
  async prioritizeSourceType(type) { this.nextSourceType = type; }
  async scanSourcePage(type, suppliedCursor, limit = 100) {
    if (type !== "reaction") return { items: [], nextCursor: undefined };
    const cursor = suppliedCursor ?? this.sourceCursors.get(type);
    const start = cursor ? this.sourceItems.findIndex((item) => item.path === cursor.path) + 1 : 0;
    const items = this.sourceItems.slice(start, start + limit);
    return {
      items,
      nextCursor: items.at(-1)
        ? { createdAt: items.at(-1).data.createdAt, path: items.at(-1).path }
        : undefined
    };
  }
  async postAuthor(source) { return source.postAuthorUid; }
  async roomMembers() { return []; }
  async createEvent(eventId, data) {
    const created = !this.events.has(eventId);
    if (created) this.events.set(eventId, { ...data });
    this.clock += this.advanceAfterMaterialization;
    return created;
  }
  async createEvents(entries) {
    let created = 0;
    for (const [eventId, data] of entries) {
      if (this.events.has(eventId)) continue;
      this.events.set(eventId, { ...data });
      created += 1;
    }
    this.clock += this.advanceAfterMaterialization;
    return created;
  }
  async advanceSourceCursor(type, cursor, nextSourceType) {
    this.sourceCursors.set(type, cursor);
    if (nextSourceType) this.nextSourceType = nextSourceType;
  }
  async heartbeat(status, errorCode) { this.heartbeats.push([status, errorCode]); }
}

const fairSource = (type, index, { memberCount = 1 } = {}) => {
  const createdAt = time(index + 1);
  if (type === "reaction") return document(
    `posts/reaction-${index}/reactions/reaction-${index}`,
    { uid: `reaction-actor-${index}`, createdAt },
    { postAuthorUid: `reaction-recipient-${index}` }
  );
  if (type === "comment") return document(
    `communityPosts/comment-${index}/comments/comment-${index}`,
    { uid: `comment-actor-${index}`, createdAt },
    { postAuthorUid: `comment-recipient-${index}` }
  );
  if (type === "message-request") return document(
    `messageRequests/request-${index}`,
    { fromId: `request-actor-${index}`, toId: `request-recipient-${index}`, status: "pending", createdAt }
  );
  if (type === "room-message") return document(
    `roomMessages/message-${index}`,
    { senderId: `room-sender-${index}`, roomId: `room-${index}`, createdAt, expiresAt: time(20_000) },
    { memberUids: Array.from({ length: memberCount }, (_, memberIndex) => `room-${index}-member-${memberIndex}`) }
  );
  return document(
    `reveals/reveal-${index}`,
    { fromId: `reveal-actor-${index}`, toId: `reveal-recipient-${index}`, status: "pending", createdAt }
  );
};

class FairSourceAdapter extends ScanAdapter {
  constructor(pages, { nextSourceType = "reaction", interruptRecipient } = {}) {
    super();
    this.pages = pages;
    this.clock = 10_000;
    this.nextSourceType = nextSourceType;
    this.interruptRecipient = interruptRecipient;
  }
  now() { return this.clock; }
  async sourcePriority() { return this.nextSourceType; }
  async prioritizeSourceType(type) { this.nextSourceType = type; }
  async scanSourcePage(type, suppliedCursor, limit = 100) {
    const all = this.pages.get(type) || [];
    const cursor = suppliedCursor ?? this.cursors.get(type);
    const start = cursor ? all.findIndex((item) => item.path === cursor.path) + 1 : 0;
    const items = all.slice(start, start + limit);
    return {
      items,
      nextCursor: items.at(-1)
        ? { createdAt: items.at(-1).data.createdAt, path: items.at(-1).path }
        : undefined
    };
  }
  async recipientAvailable(uid) {
    if (uid === this.interruptRecipient) {
      this.clock += 100;
      this.interruptRecipient = undefined;
    }
    return true;
  }
  async advanceSourceCursor(type, cursor, nextSourceType) {
    this.cursors.set(type, cursor);
    if (nextSourceType) this.nextSourceType = nextSourceType;
  }
}

{
  const fairnessPages = new Map([
    ["reaction", Array.from({ length: 105 }, (_, index) => fairSource("reaction", index))],
    ["comment", [fairSource("comment", 200)]],
    ["message-request", [fairSource("message-request", 201)]],
    ["room-message", [fairSource("room-message", 202)]],
    ["reveal-request", [fairSource("reveal-request", 203)]]
  ]);
  const fairness = new FairSourceAdapter(fairnessPages);
  const first = await scanTrustedNotificationSources({
    adapter: fairness,
    limits: { maxSources: 100, maxMaterializations: 500, maxRuntimeMs: 10_000 }
  });
  const firstRunTypes = [...new Set([...fairness.events.values()].map((event) => event.type))].sort();
  const firstRunCursors = Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, fairness.cursors.has(type)]));
  const second = await scanTrustedNotificationSources({
    adapter: fairness,
    limits: { maxSources: 100, maxMaterializations: 500, maxRuntimeMs: 10_000 }
  });
  const eventCountAfterSecondRun = fairness.events.size;
  const third = await scanTrustedNotificationSources({
    adapter: fairness,
    limits: { maxSources: 100, maxMaterializations: 500, maxRuntimeMs: 10_000 }
  });

  const highFanoutPages = new Map([
    ["reaction", [fairSource("reaction", 300)]],
    ["comment", [fairSource("comment", 301)]],
    ["room-message", [fairSource("room-message", 302, { memberCount: 499 })]],
    ["reveal-request", [fairSource("reveal-request", 303)]]
  ]);
  const highFanout = new FairSourceAdapter(highFanoutPages);
  const deferred = await scanTrustedNotificationSources({
    adapter: highFanout,
    limits: { maxSources: 100, maxMaterializations: 500, maxRuntimeMs: 10_000 }
  });
  const deferredPriority = highFanout.nextSourceType;
  const roomDeferred = !highFanout.cursors.has("room-message") && deferredPriority === "room-message";
  const resumed = await scanTrustedNotificationSources({
    adapter: highFanout,
    limits: { maxSources: 100, maxMaterializations: 500, maxRuntimeMs: 10_000 }
  });
  const resumedEventCount = highFanout.events.size;
  const replay = await scanTrustedNotificationSources({
    adapter: highFanout,
    limits: { maxSources: 100, maxMaterializations: 500, maxRuntimeMs: 10_000 }
  });

  const interrupted = new FairSourceAdapter(new Map([
    ["comment", [fairSource("comment", 400)]]
  ]), { interruptRecipient: "comment-recipient-400" });
  const interruptedFirst = await scanTrustedNotificationSources({
    adapter: interrupted,
    limits: { maxSources: 100, maxMaterializations: 500, maxRuntimeMs: 100 }
  });
  const interruptedPriority = interrupted.nextSourceType;
  const cursorDeferred = !interrupted.cursors.has("comment");
  const interruptedResume = await scanTrustedNotificationSources({
    adapter: interrupted,
    limits: { maxSources: 100, maxMaterializations: 500, maxRuntimeMs: 100 }
  });

  assert.deepEqual({
    fairness: {
      firstScanned: first.scanned,
      firstRunTypes,
      firstRunCursors,
      totalMaterialized: first.materialized + second.materialized + third.materialized,
      eventCountAfterSecondRun,
      finalEventCount: fairness.events.size,
      finalReactionCursor: fairness.cursors.get("reaction")?.path,
      replayMaterialized: third.materialized
    },
    highFanout: {
      firstScanned: deferred.scanned,
      firstMaterialized: deferred.materialized,
      deferredPriority,
      roomDeferred,
      resumedMaterialized: resumed.materialized,
      resumedEventCount,
      roomCursor: highFanout.cursors.get("room-message")?.path,
      revealCursor: highFanout.cursors.get("reveal-request")?.path,
      replayMaterialized: replay.materialized,
      finalEventCount: highFanout.events.size
    },
    interruption: {
      firstScanned: interruptedFirst.scanned,
      firstMaterialized: interruptedFirst.materialized,
      interruptedPriority,
      cursorDeferred,
      resumedMaterialized: interruptedResume.materialized,
      finalEventCount: interrupted.events.size,
      finalCursor: interrupted.cursors.get("comment")?.path
    }
  }, {
    fairness: {
      firstScanned: 100,
      firstRunTypes: [...NOTIFICATION_TYPES].sort(),
      firstRunCursors: {
        reaction: true,
        comment: true,
        "message-request": true,
        "room-message": true,
        "reveal-request": true
      },
      totalMaterialized: 109,
      eventCountAfterSecondRun: 109,
      finalEventCount: 109,
      finalReactionCursor: "posts/reaction-104/reactions/reaction-104",
      replayMaterialized: 0
    },
    highFanout: {
      firstScanned: 2,
      firstMaterialized: 2,
      deferredPriority: "room-message",
      roomDeferred: true,
      resumedMaterialized: 500,
      resumedEventCount: 502,
      roomCursor: "roomMessages/message-302",
      revealCursor: "reveals/reveal-303",
      replayMaterialized: 0,
      finalEventCount: 502
    },
    interruption: {
      firstScanned: 0,
      firstMaterialized: 0,
      interruptedPriority: "comment",
      cursorDeferred: true,
      resumedMaterialized: 1,
      finalEventCount: 1,
      finalCursor: "communityPosts/comment-400/comments/comment-400"
    }
  }, "persistent round-robin priority gives every ready type bounded progress and safely resumes deferred sources");
}

{
  const adapter = new RunBudgetAdapter(3);
  const first = await runNotificationProcessor({
    adapter,
    ownerId: "source-budget-one",
    sendPush: async () => {},
    logger: { info() {}, error() {} },
    limits: { maxSources: 1, maxMaterializations: 10, maxEvents: 10, maxSends: 10, maxRuntimeMs: 1_000 }
  });
  assert.equal(first.scanned, 1, "the whole-run source scan budget stops a backlog after one safe cursor step");
  assert.equal(first.materialized, 1);
  assert.equal(first.budgetReached, true);
  assert.equal(adapter.sourceCursors.get("reaction").path, "posts/source-0/reactions/reaction-0");

  const second = await runNotificationProcessor({
    adapter,
    ownerId: "materialization-budget-two",
    sendPush: async () => {},
    logger: { info() {}, error() {} },
    limits: { maxSources: 10, maxMaterializations: 1, maxEvents: 10, maxSends: 10, maxRuntimeMs: 1_000 }
  });
  assert.equal(second.scanned, 1, "the materialization budget leaves the next complete source for a later run");
  assert.equal(second.materialized, 1);
  assert.equal(second.budgetReached, true);
  assert.equal(adapter.sourceCursors.get("reaction").path, "posts/source-1/reactions/reaction-1");

  const third = await runNotificationProcessor({
    adapter,
    ownerId: "source-resume-three",
    sendPush: async () => {},
    logger: { info() {}, error() {} },
    limits: { maxSources: 10, maxMaterializations: 10, maxEvents: 10, maxSends: 10, maxRuntimeMs: 1_000 }
  });
  assert.equal(third.scanned, 1);
  assert.equal(adapter.sourceCursors.get("reaction").path, "posts/source-2/reactions/reaction-2");
  assert.equal(adapter.events.size, 3, "resumed source pages create each deterministic event once");
  assert.equal([...adapter.events.values()].every((event) => event.status === "delivered"), true);
}

{
  const adapter = new RunBudgetAdapter(2, { advanceAfterMaterialization: 100 });
  const limits = { maxSources: 10, maxMaterializations: 10, maxEvents: 10, maxSends: 10, maxRuntimeMs: 100 };
  const first = await runNotificationProcessor({
    adapter,
    ownerId: "deadline-one",
    sendPush: async () => {},
    logger: { info() {}, error() {} },
    limits
  });
  assert.equal(first.scanned, 1, "the deadline starts before source materialization");
  assert.equal(first.inspected, 0, "delivery cannot receive a fresh timer after source work exhausts the shared deadline");
  assert.equal(first.budgetReached, true);
  assert.equal(adapter.sourceCursors.get("reaction").path, "posts/source-0/reactions/reaction-0");

  const second = await runNotificationProcessor({
    adapter,
    ownerId: "deadline-two",
    sendPush: async () => {},
    logger: { info() {}, error() {} },
    limits
  });
  assert.equal(second.scanned, 1);
  assert.equal(second.inspected, 0);
  assert.equal(adapter.sourceCursors.get("reaction").path, "posts/source-1/reactions/reaction-1");
  assert.equal(adapter.events.size, 2, "deadline resumption neither loses nor duplicates materialized events");

  adapter.advanceAfterMaterialization = 0;
  const resumed = await runNotificationProcessor({
    adapter,
    ownerId: "deadline-resume",
    sendPush: async () => {},
    logger: { info() {}, error() {} },
    limits
  });
  assert.equal(resumed.scanned, 0);
  assert.equal(resumed.delivered, 2, "a later run resumes delivery after the source backlog is safely cursor-complete");
}

console.log("Notification processor behavior passed");
