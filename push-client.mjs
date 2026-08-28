import {
  PUSH_ALERT_STATES,
  createPushSubscriptionRecord,
  pushCapabilityState,
  urlBase64ToUint8Array
} from "./push-policy.mjs";

export const PUSH_ALERT_MESSAGES = Object.freeze({
  [PUSH_ALERT_STATES.ENABLING]: "Enabling phone alerts…",
  [PUSH_ALERT_STATES.ENABLED]: "Phone alerts are on for this device.",
  [PUSH_ALERT_STATES.BLOCKED]: "Your browser blocked notifications. Allow them in browser settings, then try again.",
  [PUSH_ALERT_STATES.UNSUPPORTED]: "Phone alerts are not supported by this browser.",
  [PUSH_ALERT_STATES.INSTALL_REQUIRED]: "On iPhone, add AnonChat to your Home Screen before enabling phone alerts.",
  [PUSH_ALERT_STATES.CONFIGURATION_PENDING]: "Phone alerts are not configured yet. Please try again later.",
  [PUSH_ALERT_STATES.RETRY]: "Phone alerts could not be saved safely. Please try again."
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
  onState = () => {},
  logger = console
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

  const reconcile = async (user, allowCreate) => {
    try {
      const registration = await serviceWorkerReady;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription && allowCreate) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }
      if (!subscription) return null;
      const record = await createPushSubscriptionRecord({
        uid: user.uid,
        subscription,
        timestamp: timestamp(),
        subtle
      });
      await persist(record);
      onState(PUSH_ALERT_STATES.ENABLED);
      return PUSH_ALERT_STATES.ENABLED;
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
    }
  };
}
