export const PUSH_ALERT_STATES = Object.freeze({
  ENABLING: "enabling",
  ENABLED: "enabled",
  BLOCKED: "blocked",
  UNSUPPORTED: "unsupported",
  INSTALL_REQUIRED: "install-required",
  CONFIGURATION_PENDING: "configuration-pending",
  DEVICE_SETTINGS: "device-settings",
  RETRY: "retry"
});

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function pushCapabilityState({
  notificationSupported,
  serviceWorkerSupported,
  pushSupported,
  isIOS = false,
  isStandalone = false,
  publicKey = "",
  permission = "default"
}) {
  if (!notificationSupported || !serviceWorkerSupported || !pushSupported) {
    return PUSH_ALERT_STATES.UNSUPPORTED;
  }
  if (isIOS && !isStandalone) return PUSH_ALERT_STATES.INSTALL_REQUIRED;
  if (!publicKey) return PUSH_ALERT_STATES.CONFIGURATION_PENDING;
  if (permission === "denied") return PUSH_ALERT_STATES.BLOCKED;
  return null;
}

export function urlBase64ToUint8Array(value) {
  if (!value) throw new Error("Push alerts are not configured.");
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    throw new Error("The VAPID public key must be base64url encoded.");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of value) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

export async function pushSubscriptionId(endpoint, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error("Secure hashing is unavailable.");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validatedSubscription(subscription) {
  const endpoint = subscription?.endpoint;
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
    throw new Error("The push endpoint must use HTTPS.");
  }
  if (endpoint.length > 2048) throw new Error("The push endpoint must be at most 2048 characters.");
  const expirationTime = subscription.expirationTime ?? null;
  if (expirationTime !== null && (!Number.isSafeInteger(expirationTime) || expirationTime < 0)) {
    throw new Error("The push expiration time must be null or a nonnegative integer.");
  }
  const json = subscription.toJSON?.();
  const p256dh = json?.keys?.p256dh;
  const auth = json?.keys?.auth;
  if (typeof p256dh !== "string" || !BASE64URL_PATTERN.test(p256dh) || p256dh.length > 128) {
    throw new Error("The p256dh key must be a nonempty base64url value no longer than 128 characters.");
  }
  if (typeof auth !== "string" || !BASE64URL_PATTERN.test(auth) || auth.length > 64) {
    throw new Error("The auth key must be a nonempty base64url value no longer than 64 characters.");
  }
  return { endpoint, expirationTime, p256dh, auth };
}

export async function createPushSubscriptionRecord({ uid, subscription, timestamp, subtle }) {
  if (typeof uid !== "string" || !uid) throw new Error("A signed-in user is required.");
  if (!timestamp) throw new Error("A trusted server timestamp is required.");
  const validated = validatedSubscription(subscription);
  return {
    id: await pushSubscriptionId(validated.endpoint, subtle),
    data: {
      uid,
      endpoint: validated.endpoint,
      expirationTime: validated.expirationTime,
      p256dh: validated.p256dh,
      auth: validated.auth,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  };
}
