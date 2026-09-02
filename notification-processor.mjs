import {
  ACCOUNT_LIMIT,
  MAX_NOTIFICATION_EVENTS_PER_RUN,
  MAX_NOTIFICATION_MATERIALIZATIONS_PER_RUN,
  MAX_NOTIFICATION_RUNTIME_MS,
  MAX_NOTIFICATION_SENDS_PER_RUN,
  MAX_NOTIFICATION_SOURCES_PER_RUN,
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

const actorFor = (type, data) => ["room-message", "premium-room-message", "private-message"].includes(type)
  ? data.senderId
  : ["message-request", "reveal-request"].includes(type)
    ? data.fromId
    : data.uid;

const boundedLimit = (value, maximum) => Number.isInteger(value) && value > 0
  ? Math.min(value, maximum)
  : maximum;
const boundedRuntime = (value) => Number.isFinite(value) && value > 0
  ? Math.min(value, MAX_NOTIFICATION_RUNTIME_MS)
  : MAX_NOTIFICATION_RUNTIME_MS;
const createInvocationBudget = (adapter, limits = {}) => {
  const startedAt = adapter.now();
  return {
    deadlineAt: startedAt + boundedRuntime(limits.maxRuntimeMs),
    maxSources: boundedLimit(limits.maxSources, MAX_NOTIFICATION_SOURCES_PER_RUN),
    maxMaterializations: boundedLimit(
      limits.maxMaterializations,
      MAX_NOTIFICATION_MATERIALIZATIONS_PER_RUN
    ),
    maxEvents: boundedLimit(limits.maxEvents, MAX_NOTIFICATION_EVENTS_PER_RUN),
    maxSends: boundedLimit(limits.maxSends, MAX_NOTIFICATION_SENDS_PER_RUN),
    sources: 0,
    materializations: 0,
    events: 0,
    sends: 0,
    reached: false
  };
};
const runtimeReached = (adapter, budget) => adapter.now() >= budget.deadlineAt;
const markBudgetReached = (budget) => { budget.reached = true; };

const recipientsFor = async (adapter, type, source) => {
  const actorUid = actorFor(type, source.data);
  if (["reaction", "comment"].includes(type)) {
    const author = await adapter.postAuthor(source);
    const mentioned = type === "comment" && adapter.mentionedUsers
      ? await adapter.mentionedUsers(source.data.text)
      : [];
    return [...new Set([author, ...mentioned])].filter((uid) => uid && uid !== actorUid);
  }
  if (type === "private-message") {
    return source.data.participants.filter((uid) => uid !== actorUid);
  }
  if (["message-request", "reveal-request"].includes(type)) return [source.data.toId];
  const members = await adapter.roomMembers(source, type);
  return [...new Set(members.filter((uid) => typeof uid === "string" && uid && uid !== actorUid))]
    .slice(0, ACCOUNT_LIMIT - 1);
};

export const scanTrustedNotificationSources = async ({ adapter, budget, limits = {} }) => {
  const invocation = budget ?? createInvocationBudget(adapter, limits);
  const result = { bootstrapped: false, scanned: 0, materialized: 0 };
  if (await adapter.bootstrapSourceCursors(NOTIFICATION_TYPES)) {
    result.bootstrapped = true;
    return result;
  }
  const storedPriority = await adapter.sourcePriority();
  const priorityIndex = NOTIFICATION_TYPES.indexOf(storedPriority);
  const orderedTypes = priorityIndex >= 0
    ? [...NOTIFICATION_TYPES.slice(priorityIndex), ...NOTIFICATION_TYPES.slice(0, priorityIndex)]
    : [...NOTIFICATION_TYPES];
  const pageLimit = Math.max(1, Math.floor(invocation.maxSources / NOTIFICATION_TYPES.length));
  const sourceStates = orderedTypes.map((type) => ({ type, cursor: undefined, items: [], exhausted: false }));
  const nextReadyType = (stateIndex) => {
    for (let offset = 1; offset <= sourceStates.length; offset += 1) {
      const candidate = sourceStates[(stateIndex + offset) % sourceStates.length];
      if (!candidate.exhausted) return candidate.type;
    }
    return orderedTypes[(stateIndex + 1) % orderedTypes.length];
  };
  let stateIndex = 0;
  sourceScan:
  while (sourceStates.some((state) => !state.exhausted)) {
    if (invocation.sources >= invocation.maxSources
      || invocation.materializations >= invocation.maxMaterializations
      || runtimeReached(adapter, invocation)) {
      markBudgetReached(invocation);
      break;
    }
    const currentStateIndex = stateIndex;
    const state = sourceStates[currentStateIndex];
    stateIndex = (stateIndex + 1) % sourceStates.length;
    if (state.exhausted) continue;
    if (!state.items.length) {
      const page = await adapter.scanSourcePage(
        state.type,
        state.cursor,
        Math.min(pageLimit, invocation.maxSources - invocation.sources)
      );
      if (!page.items.length) {
        state.exhausted = true;
        continue;
      }
      state.items = [...page.items];
    }

    const source = state.items.shift();
    await adapter.prioritizeSourceType(state.type);
    if (runtimeReached(adapter, invocation)) {
      markBudgetReached(invocation);
      break;
    }
    const next = sourceCursor(source);
    if (state.cursor && compareSourceCursors(next, state.cursor) <= 0) {
      throw Object.assign(new Error("cursor limit"), { code: "cursor-limit" });
    }
    const events = [];
    if (validateTrustedSource(state.type, source.data, adapter.now())) {
      const actorUid = actorFor(state.type, source.data);
      const recipients = await recipientsFor(adapter, state.type, source);
      const availableRecipients = [];
      const unblockedRecipients = await adapter.unblockedRecipients(actorUid, recipients);
      for (const recipientUid of unblockedRecipients) {
        if (runtimeReached(adapter, invocation)) {
          markBudgetReached(invocation);
          break sourceScan;
        }
        if (recipientUid !== actorUid && await adapter.recipientAvailable(recipientUid)) {
          availableRecipients.push(recipientUid);
        }
      }
      if (runtimeReached(adapter, invocation)) {
        markBudgetReached(invocation);
        break;
      }
      if (availableRecipients.length > invocation.maxMaterializations - invocation.materializations) {
        markBudgetReached(invocation);
        break;
      }
      for (const recipientUid of availableRecipients) {
        if (runtimeReached(adapter, invocation)) {
          markBudgetReached(invocation);
          break sourceScan;
        }
        const eventId = await createEventId({
          type: state.type,
          sourcePath: source.path,
          sourceCreatedAt: source.data.createdAt,
          recipientUid
        });
        events.push([eventId, queuedEvent({
          type: state.type,
          actorUid,
          recipientUid,
          ...(["room-message", "premium-room-message"].includes(state.type) ? { roomId: source.data.roomId } : {}),
          route: notificationRoute(state.type),
          sourceCreatedAt: source.data.createdAt,
          now: adapter.timestamp(adapter.now())
        })]);
      }
    }
    if (runtimeReached(adapter, invocation)) {
      markBudgetReached(invocation);
      break;
    }
    const created = events.length ? await adapter.createEvents(events) : 0;
    invocation.materializations += events.length;
    result.materialized += created;
    invocation.sources += 1;
    result.scanned += 1;
    await adapter.advanceSourceCursor(state.type, next, nextReadyType(currentStateIndex));
    state.cursor = next;
    if (runtimeReached(adapter, invocation)) {
      markBudgetReached(invocation);
      break;
    }
  }
  return result;
};

export const deliverNotificationEvents = async ({
  adapter,
  ownerId,
  sendPush,
  logger = console,
  limits = {},
  budget
}) => {
  const invocation = budget ?? createInvocationBudget(adapter, limits);
  const result = {
    inspected: 0,
    sent: 0,
    delivered: 0,
    retried: 0,
    suppressed: 0,
    exhausted: 0,
    deferred: 0,
    expired: 0,
    skipped: 0,
    purged: 0,
    budgetReached: invocation.reached
  };
  let stop = false;
  let cursor;
  while (!stop) {
    if (invocation.events >= invocation.maxEvents
      || invocation.sends >= invocation.maxSends
      || runtimeReached(adapter, invocation)) {
      markBudgetReached(invocation);
      result.budgetReached = true;
      break;
    }
    const page = await adapter.scanEventPage(cursor);
    if (!page.items.length) break;
    for (const item of page.items) {
      if (invocation.events >= invocation.maxEvents
        || invocation.sends >= invocation.maxSends
        || runtimeReached(adapter, invocation)) {
        markBudgetReached(invocation);
        result.budgetReached = true;
        stop = true;
        break;
      }
      invocation.events += 1;
      result.inspected += 1;
      let claim;
      try {
        claim = await adapter.claimEvent(item.id, ownerId);
        if (!claim) {
          result.skipped += 1;
          continue;
        }
        if (claim.terminal === "exhausted") {
          result.exhausted += 1;
          safeLog(logger, "error", "EVENT_EXHAUSTED");
          continue;
        }
        if (claim.terminal === "suppressed") {
          result.suppressed += 1;
          safeLog(logger, "info", claim.errorCode || "LEGACY_ROOM_CONTEXT_MISSING");
          continue;
        }
        const roomUnavailable = async () => claim.data.type === "room-message"
          ? !(await adapter.roomAvailable(claim.data.roomId))
          : claim.data.type === "premium-room-message"
            ? !(await adapter.premiumRoomAvailable(claim.data.roomId))
            : false;
        if (await roomUnavailable()) {
          await adapter.suppressEvent(claim.id, claim.token, "ROOM_UNAVAILABLE");
          result.suppressed += 1;
          safeLog(logger, "info", "ROOM_UNAVAILABLE");
          continue;
        }
        if (!(await adapter.recipientAvailable(claim.data.recipientUid))) {
          await adapter.suppressEvent(claim.id, claim.token);
          result.suppressed += 1;
          safeLog(logger, "info", "RECIPIENT_UNAVAILABLE");
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
        let recipientUnavailable = false;
        let blockedPair = false;
        let invocationDeferred = false;
        for (const subscription of subscriptions) {
          await adapter.renewEvent(claim.id, claim.token);
          const { subscriptionFingerprint, deliveryId } = await deliveryIdentity(subscription);
          const settled = await adapter.getDelivery(deliveryId);
          if (["delivered", "expired"].includes(settled?.status)) continue;
          if (invocation.sends >= invocation.maxSends || runtimeReached(adapter, invocation)) {
            invocationDeferred = true;
            markBudgetReached(invocation);
            result.budgetReached = true;
            break;
          }
          if (!(await adapter.recipientAvailable(claim.data.recipientUid))) {
            recipientUnavailable = true;
            break;
          }
          if (await roomUnavailable()) {
            recipientUnavailable = "room";
            break;
          }
          if (await adapter.pairBlocked(claim.data.actorUid, claim.data.recipientUid)) {
            blockedPair = true;
            break;
          }
          let pushError;
          try {
            invocation.sends += 1;
            result.sent += 1;
            const actorLabel = claim.data.type === "room-message"
              ? await adapter.roomAlias?.(claim.data.roomId, claim.data.actorUid, claim.data.sourceCreatedAt) ?? "Someone"
              : await adapter.userName?.(claim.data.actorUid) ?? "Someone";
            await sendPush(subscription, notificationPayload(claim.data.type, claim.id, actorLabel));
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
        if (recipientUnavailable) {
          const roomUnavailableAtDelivery = recipientUnavailable === "room";
          await adapter.suppressEvent(claim.id, claim.token, roomUnavailableAtDelivery ? "ROOM_UNAVAILABLE" : "RECIPIENT_UNAVAILABLE");
          result.suppressed += 1;
          safeLog(logger, "info", roomUnavailableAtDelivery ? "ROOM_UNAVAILABLE" : "RECIPIENT_UNAVAILABLE");
          continue;
        }
        if (blockedPair) {
          await adapter.suppressEvent(claim.id, claim.token, "BLOCKED_PAIR");
          result.suppressed += 1;
          safeLog(logger, "info", "BLOCKED_PAIR");
          continue;
        }
        if (invocationDeferred) {
          await adapter.deferEvent(claim.id, claim.token);
          result.deferred += 1;
          stop = true;
          safeLog(logger, "info", "INVOCATION_BUDGET");
          continue;
        }
        await adapter.renewEvent(claim.id, claim.token);
        for (const subscription of await listCurrentSubscriptions()) {
          const { deliveryId } = await deliveryIdentity(subscription);
          const settled = await adapter.getDelivery(deliveryId);
          if (!["delivered", "expired"].includes(settled?.status)) transientFailure = true;
        }
        if (await adapter.pairBlocked(claim.data.actorUid, claim.data.recipientUid)) {
          await adapter.suppressEvent(claim.id, claim.token, "BLOCKED_PAIR");
          result.suppressed += 1;
          safeLog(logger, "info", "BLOCKED_PAIR");
          continue;
        }
        if (await roomUnavailable()) {
          await adapter.suppressEvent(claim.id, claim.token, "ROOM_UNAVAILABLE");
          result.suppressed += 1;
          safeLog(logger, "info", "ROOM_UNAVAILABLE");
          continue;
        }
        if (transientFailure) {
          const status = await adapter.failEvent(claim.id, claim.token, "DELIVERY_TRANSIENT");
          if (status === "exhausted") result.exhausted += 1;
          else result.retried += 1;
        } else {
          await adapter.completeEvent(claim.id, claim.token);
          result.delivered += 1;
          safeLog(logger, "info", "EVENT_DELIVERED");
        }
      } catch (error) {
        let status = "failed";
        if (claim?.token) {
          try { status = await adapter.failEvent(claim.id, claim.token, fixedNotificationErrorCode(error)); }
          catch { safeLog(logger, "error", "FAIL_STATE_ERROR"); }
        }
        if (status === "exhausted") result.exhausted += 1;
        else result.retried += 1;
        safeLog(logger, "error", fixedNotificationErrorCode(error));
      }
    }
    if (stop) break;
    if (!page.nextCursor) {
      throw Object.assign(new Error("cursor limit"), { code: "cursor-limit" });
    }
    cursor = page.nextCursor;
  }
  if (!runtimeReached(adapter, invocation)) {
    result.purged = await adapter.purgeTerminalBefore(
      adapter.timestamp(adapter.now() - NOTIFICATION_RETENTION_MS),
      MAX_NOTIFICATION_EVENTS_PER_RUN
    );
  } else {
    markBudgetReached(invocation);
  }
  result.budgetReached = invocation.reached;
  safeLog(logger, "info", `NOTIFICATION_RESULT inspected=${result.inspected} sent=${result.sent} delivered=${result.delivered} retried=${result.retried} suppressed=${result.suppressed} exhausted=${result.exhausted} deferred=${result.deferred} expired=${result.expired} skipped=${result.skipped} purged=${result.purged}`);
  return result;
};

export const runNotificationProcessor = async ({
  adapter,
  ownerId,
  sendPush,
  logger = console,
  limits = {}
}) => {
  const budget = createInvocationBudget(adapter, limits);
  await adapter.heartbeat("started");
  try {
    const scan = await scanTrustedNotificationSources({ adapter, budget });
    const delivery = await deliverNotificationEvents({ adapter, ownerId, sendPush, logger, budget });
    await adapter.heartbeat(delivery.retried ? "error" : "completed", delivery.retried ? "DELIVERY_TRANSIENT" : undefined);
    return { ...scan, ...delivery };
  } catch (error) {
    try { await adapter.heartbeat("error", fixedNotificationErrorCode(error)); }
    catch { safeLog(logger, "error", "HEARTBEAT_ERROR"); }
    throw error;
  }
};
