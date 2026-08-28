import {
  ACCOUNT_LIMIT,
  MAX_SUBSCRIPTIONS_PER_RECIPIENT,
  NOTIFICATION_RETENTION_MS,
  NOTIFICATION_TYPES,
  compareSourceCursors,
  createDeliveryId,
  createEventId,
  createSubscriptionVersionFingerprint,
  fixedNotificationErrorCode,
  notificationPayload,
  notificationRoute,
  queuedEvent,
  sourceCursor,
  validateTrustedSource
} from "./notification-policy.mjs";

const codedError = (code) => Object.assign(new Error(code), { code });

const safeLog = (logger, level, code) => {
  const method = typeof logger?.[level] === "function" ? logger[level] : logger?.log;
  if (typeof method === "function") method.call(logger, code);
};

const actorFor = (type, data) => type === "room-message"
  ? data.senderId
  : ["message-request", "reveal-request"].includes(type)
    ? data.fromId
    : data.uid;

const recipientsFor = async (adapter, type, source) => {
  const actorUid = actorFor(type, source.data);
  if (["reaction", "comment"].includes(type)) {
    const author = await adapter.postAuthor(source);
    return author && author !== actorUid ? [author] : [];
  }
  if (["message-request", "reveal-request"].includes(type)) return [source.data.toId];
  const members = await adapter.roomMembers(source);
  return [...new Set(members.filter((uid) => typeof uid === "string" && uid && uid !== actorUid))]
    .slice(0, ACCOUNT_LIMIT - 1);
};

export const scanTrustedNotificationSources = async ({ adapter }) => {
  const result = { bootstrapped: false, scanned: 0, materialized: 0 };
  if (await adapter.bootstrapSourceCursors(NOTIFICATION_TYPES)) {
    result.bootstrapped = true;
    return result;
  }
  for (const type of NOTIFICATION_TYPES) {
    let cursor;
    while (true) {
      const page = await adapter.scanSourcePage(type, cursor);
      if (!page.items.length) break;
      result.scanned += page.items.length;
      for (const source of page.items) {
        if (!validateTrustedSource(type, source.data, adapter.now())) continue;
        const actorUid = actorFor(type, source.data);
        for (const recipientUid of await recipientsFor(adapter, type, source)) {
          if (recipientUid === actorUid || !(await adapter.recipientAvailable(recipientUid))) continue;
          const eventId = await createEventId({
            type,
            sourcePath: source.path,
            sourceCreatedAt: source.data.createdAt,
            recipientUid
          });
          await adapter.createEvent(eventId, queuedEvent({
            type,
            actorUid,
            recipientUid,
            route: notificationRoute(type),
            sourceCreatedAt: source.data.createdAt,
            now: adapter.timestamp(adapter.now())
          }));
          result.materialized += 1;
        }
      }
      const next = page.nextCursor ?? sourceCursor(page.items.at(-1));
      if (cursor && compareSourceCursors(next, cursor) <= 0) {
        throw Object.assign(new Error("cursor limit"), { code: "cursor-limit" });
      }
      await adapter.advanceSourceCursor(type, next);
      cursor = next;
    }
  }
  return result;
};

export const deliverNotificationEvents = async ({ adapter, ownerId, sendPush, logger = console }) => {
  const result = { inspected: 0, delivered: 0, retried: 0, expired: 0, skipped: 0, purged: 0 };
  let cursor;
  while (true) {
    const page = await adapter.scanEventPage(cursor);
    if (!page.items.length) break;
    for (const item of page.items) {
      result.inspected += 1;
      let claim;
      try {
        claim = await adapter.claimEvent(item.id, ownerId);
        if (!claim) {
          result.skipped += 1;
          continue;
        }
        const listCurrentSubscriptions = async () => {
          const current = await adapter.listSubscriptions(claim.data.recipientUid);
          if (current.length > MAX_SUBSCRIPTIONS_PER_RECIPIENT) throw codedError("subscription-limit");
          return current;
        };
        const deliveryIdentity = async (subscription) => {
          const subscriptionFingerprint = await createSubscriptionVersionFingerprint(subscription);
          return {
            subscriptionFingerprint,
            deliveryId: await createDeliveryId(claim.id, subscription.id, subscriptionFingerprint)
          };
        };
        const subscriptions = await listCurrentSubscriptions();
        let transientFailure = false;
        for (const subscription of subscriptions) {
          await adapter.renewEvent(claim.id, claim.token);
          const { subscriptionFingerprint, deliveryId } = await deliveryIdentity(subscription);
          const settled = await adapter.getDelivery(deliveryId);
          if (["delivered", "expired"].includes(settled?.status)) continue;
          let pushError;
          try {
            await sendPush(subscription, notificationPayload(claim.data.type, claim.id));
          } catch (error) {
            pushError = error;
          }
          await adapter.renewEvent(claim.id, claim.token);
          if (!pushError) {
            const timestamp = adapter.timestamp(adapter.now());
            await adapter.markDelivery(deliveryId, {
              eventId: claim.id,
              recipientUid: claim.data.recipientUid,
              subscriptionId: subscription.id,
              subscriptionFingerprint,
              status: "delivered",
              createdAt: timestamp,
              updatedAt: timestamp
            });
          } else {
            if ([404, 410].includes(pushError?.statusCode)) {
              const timestamp = adapter.timestamp(adapter.now());
              const removed = await adapter.expireSubscriptionVersion(subscription, deliveryId, {
                eventId: claim.id,
                recipientUid: claim.data.recipientUid,
                subscriptionId: subscription.id,
                subscriptionFingerprint,
                status: "expired",
                createdAt: timestamp,
                updatedAt: timestamp
              });
              if (!removed) {
                transientFailure = true;
                safeLog(logger, "info", "SUBSCRIPTION_CHANGED");
                continue;
              }
              result.expired += 1;
              safeLog(logger, "info", "SUBSCRIPTION_EXPIRED");
            } else {
              transientFailure = true;
              safeLog(logger, "error", fixedNotificationErrorCode(pushError));
            }
          }
        }
        await adapter.renewEvent(claim.id, claim.token);
        for (const subscription of await listCurrentSubscriptions()) {
          const { deliveryId } = await deliveryIdentity(subscription);
          const settled = await adapter.getDelivery(deliveryId);
          if (!["delivered", "expired"].includes(settled?.status)) transientFailure = true;
        }
        if (transientFailure) {
          await adapter.failEvent(claim.id, claim.token, "DELIVERY_TRANSIENT");
          result.retried += 1;
        } else {
          await adapter.completeEvent(claim.id, claim.token);
          result.delivered += 1;
          safeLog(logger, "info", "EVENT_DELIVERED");
        }
      } catch (error) {
        result.retried += 1;
        if (claim?.token) {
          try { await adapter.failEvent(claim.id, claim.token, fixedNotificationErrorCode(error)); }
          catch { safeLog(logger, "error", "FAIL_STATE_ERROR"); }
        }
        safeLog(logger, "error", fixedNotificationErrorCode(error));
      }
    }
    if (!page.nextCursor || page.nextCursor === cursor) {
      throw Object.assign(new Error("cursor limit"), { code: "cursor-limit" });
    }
    cursor = page.nextCursor;
  }
  result.purged = await adapter.purgeDeliveredBefore(adapter.timestamp(adapter.now() - NOTIFICATION_RETENTION_MS));
  safeLog(logger, "info", `NOTIFICATION_RESULT inspected=${result.inspected} delivered=${result.delivered} retried=${result.retried} expired=${result.expired} skipped=${result.skipped} purged=${result.purged}`);
  return result;
};

export const runNotificationProcessor = async ({ adapter, ownerId, sendPush, logger = console }) => {
  await adapter.heartbeat("started");
  try {
    const scan = await scanTrustedNotificationSources({ adapter });
    const delivery = await deliverNotificationEvents({ adapter, ownerId, sendPush, logger });
    await adapter.heartbeat(delivery.retried ? "error" : "completed", delivery.retried ? "DELIVERY_TRANSIENT" : undefined);
    return { ...scan, ...delivery };
  } catch (error) {
    try { await adapter.heartbeat("error", fixedNotificationErrorCode(error)); }
    catch { safeLog(logger, "error", "HEARTBEAT_ERROR"); }
    throw error;
  }
};
