import {
  PUSH_ALERT_STATES,
  createPushSubscriptionRecord,
  pushCapabilityState,
  pushSubscriptionId,
  urlBase64ToUint8Array
} from "./push-policy.mjs";

export const PUSH_ALERT_MESSAGES = Object.freeze({
  [PUSH_ALERT_STATES.ENABLING]: "Enabling phone alerts…",
  [PUSH_ALERT_STATES.ENABLED]: "Phone alerts are on for this device.",
  [PUSH_ALERT_STATES.BLOCKED]: "Your browser blocked notifications. Allow them in browser settings, then try again.",
  [PUSH_ALERT_STATES.UNSUPPORTED]: "Phone alerts are not supported by this browser.",
  [PUSH_ALERT_STATES.INSTALL_REQUIRED]: "On iPhone, add AnonChat to your Home Screen before enabling phone alerts.",
  [PUSH_ALERT_STATES.CONFIGURATION_PENDING]: "Phone alerts are not configured yet. Please try again later.",
  [PUSH_ALERT_STATES.RETRY]: "Phone alerts could not finish setting up. Refresh this page, then tap Enable phone alerts again."
});

export function createPushAlertsClient({
  notification,
  serviceWorkerSupported,
  pushSupported,
  serviceWorkerReady,
  publicKey,
  isIOS = false,
  isStandalone = false,
  subtle = globalThis.crypto?.subtle,
  timestamp,
  persist,
  remove = async () => {},
  onState = () => {},
  logger = console,
  readinessTimeoutMs = 30_000,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout
}) {
  const capabilityState = () => pushCapabilityState({
    notificationSupported: Boolean(notification),
    serviceWorkerSupported,
    pushSupported,
    isIOS,
    isStandalone,
    publicKey,
    permission: notification?.permission
  });

  const reportFailure = () => {
    logger?.error?.("Phone alerts could not be enabled.");
    onState(PUSH_ALERT_STATES.RETRY);
    return PUSH_ALERT_STATES.RETRY;
  };

  const waitForRegistration = () => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeoutFn(timer);
      callback(value);
    };
    const timer = setTimeoutFn(
      () => finish(reject, new Error("Service worker readiness timed out.")),
      readinessTimeoutMs
    );
    Promise.resolve(serviceWorkerReady).then(
      (registration) => finish(resolve, registration),
      (error) => finish(reject, error)
    );
  });

  const unsubscribeSafely = async (subscription) => {
    try {
      return (await subscription.unsubscribe()) !== false;
    } catch {
      logger?.error?.("Phone alert cleanup could not finish.");
      return false;
    }
  };

  const persistForUser = async (user, subscription) => {
    const record = await createPushSubscriptionRecord({
      uid: user.uid,
      subscription,
      timestamp: timestamp(),
      subtle
    });
    await persist(record);
    return record;
  };

  const reconcile = async (user, allowCreate) => {
    try {
      const registration = await waitForRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        try {
          await persistForUser(user, subscription);
          onState(PUSH_ALERT_STATES.ENABLED);
          return PUSH_ALERT_STATES.ENABLED;
        } catch {
          const removed = await unsubscribeSafely(subscription);
          if (!allowCreate || !removed) return reportFailure();
          subscription = null;
        }
      }
      if (allowCreate) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }
      if (!subscription) return null;
      try {
        await persistForUser(user, subscription);
        onState(PUSH_ALERT_STATES.ENABLED);
        return PUSH_ALERT_STATES.ENABLED;
      } catch {
        await unsubscribeSafely(subscription);
        return reportFailure();
      }
    } catch {
      return reportFailure();
    }
  };

  return {
    async enableFromGesture(user) {
      const blockedState = capabilityState();
      if (blockedState) {
        onState(blockedState);
        return blockedState;
      }
      onState(PUSH_ALERT_STATES.ENABLING);
      try {
        const permission = notification.permission === "granted"
          ? "granted"
          : await notification.requestPermission();
        if (permission !== "granted") {
          onState(PUSH_ALERT_STATES.BLOCKED);
          return PUSH_ALERT_STATES.BLOCKED;
        }
      } catch {
        return reportFailure();
      }
      return reconcile(user, true);
    },

    async reconcileExisting(user) {
      const blockedState = capabilityState();
      if (blockedState) {
        if (blockedState !== null) onState(blockedState);
        return blockedState;
      }
      if (notification.permission !== "granted") return null;
      return reconcile(user, false);
    },

    async cleanupForSignOut(user, { removeDocument = true } = {}) {
      if (!serviceWorkerSupported || !pushSupported) return true;
      let subscription;
      try {
        const registration = await waitForRegistration();
        subscription = await registration.pushManager.getSubscription();
        if (!subscription) return true;
        if (removeDocument) {
          try {
            await remove({
              id: await pushSubscriptionId(subscription.endpoint, subtle),
              uid: user.uid
            });
          } catch {
            logger?.error?.("Phone alert document cleanup could not finish.");
          }
        }
      } catch {
        logger?.error?.("Phone alert cleanup could not start.");
        return false;
      }
      return unsubscribeSafely(subscription);
    }
  };
}
