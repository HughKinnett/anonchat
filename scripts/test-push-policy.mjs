import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  PUSH_ALERT_STATES,
  createPushSubscriptionRecord,
  pushCapabilityState,
  pushSubscriptionId,
  urlBase64ToUint8Array
} from "../push-policy.mjs";

const endpoint = "https://push.example/subscription/device-1";
const timestamp = { sentinel: "serverTimestamp" };
const subscription = {
  endpoint,
  expirationTime: null,
  toJSON() {
    return {
      endpoint: this.endpoint,
      expirationTime: this.expirationTime,
      keys: {
        p256dh: "BNc9_fR0-valid-p256dh",
        auth: "valid_auth-key"
      }
    };
  }
};

assert.equal(pushCapabilityState({ notificationSupported: false }), PUSH_ALERT_STATES.UNSUPPORTED);
assert.equal(pushCapabilityState({ notificationSupported: true, serviceWorkerSupported: false }), PUSH_ALERT_STATES.UNSUPPORTED);
assert.equal(pushCapabilityState({ notificationSupported: true, serviceWorkerSupported: true, pushSupported: false }), PUSH_ALERT_STATES.UNSUPPORTED);
assert.equal(pushCapabilityState({ notificationSupported: true, serviceWorkerSupported: true, pushSupported: true, isIOS: true, isStandalone: false, publicKey: "configured" }), PUSH_ALERT_STATES.INSTALL_REQUIRED);
assert.equal(pushCapabilityState({ notificationSupported: true, serviceWorkerSupported: true, pushSupported: true, isIOS: false, isStandalone: false, publicKey: "" }), PUSH_ALERT_STATES.CONFIGURATION_PENDING);
assert.equal(pushCapabilityState({ notificationSupported: true, serviceWorkerSupported: true, pushSupported: true, isIOS: false, isStandalone: false, publicKey: "configured", permission: "denied" }), PUSH_ALERT_STATES.BLOCKED);

assert.deepEqual(
  [...urlBase64ToUint8Array("AQID-_8")],
  [1, 2, 3, 251, 255],
  "VAPID base64url values decode without depending on browser atob"
);
assert.throws(() => urlBase64ToUint8Array("not+base64"), /base64url/i);
assert.throws(() => urlBase64ToUint8Array(""), /configured/i);

assert.equal(
  await pushSubscriptionId(endpoint, webcrypto.subtle),
  "498a9d6c06740be427b82ee6e291978a361e022f49476485b30cd2445b491442",
  "the document ID is the stable lowercase SHA-256 endpoint digest"
);

const record = await createPushSubscriptionRecord({
  uid: "user-a",
  subscription,
  timestamp,
  timezoneOffsetMinutes: 300,
  subtle: webcrypto.subtle
});
assert.deepEqual(record, {
  id: "498a9d6c06740be427b82ee6e291978a361e022f49476485b30cd2445b491442",
  data: {
    uid: "user-a",
    endpoint,
    expirationTime: null,
    p256dh: "BNc9_fR0-valid-p256dh",
    auth: "valid_auth-key",
    timezoneOffsetMinutes: 300,
    createdAt: timestamp,
    updatedAt: timestamp
  }
});
const recordWithoutExpiration = await createPushSubscriptionRecord({
  uid: "user-a",
  subscription: { ...subscription, expirationTime: undefined },
  timestamp,
  timezoneOffsetMinutes: -240,
  subtle: webcrypto.subtle
});
assert.equal(recordWithoutExpiration.data.expirationTime, null,
  "mobile browsers that omit expirationTime are normalized to null");
assert.equal(recordWithoutExpiration.data.timezoneOffsetMinutes, -240,
  "the device timezone offset is retained for local quiet-hour evaluation");

assert.deepEqual(
  Object.keys(record.data).sort(),
  ["auth", "createdAt", "endpoint", "expirationTime", "p256dh", "timezoneOffsetMinutes", "uid", "updatedAt"],
  "serialization retains only push delivery metadata needed by the service"
);

await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription, timestamp, timezoneOffsetMinutes: 841, subtle: webcrypto.subtle }),
  /timezone/i
);
await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription, timestamp, timezoneOffsetMinutes: 1.5, subtle: webcrypto.subtle }),
  /timezone/i
);
await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription: { ...subscription, endpoint: "http://push.example/device" }, timestamp, timezoneOffsetMinutes: 0, subtle: webcrypto.subtle }),
  /HTTPS/i
);
await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription: { ...subscription, endpoint: `https://push.example/${"x".repeat(2049)}` }, timestamp, timezoneOffsetMinutes: 0, subtle: webcrypto.subtle }),
  /2048/
);
await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription: { endpoint, expirationTime: -1, toJSON: subscription.toJSON }, timestamp, timezoneOffsetMinutes: 0, subtle: webcrypto.subtle }),
  /expiration/i
);
await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription: { endpoint, expirationTime: 1.5, toJSON: subscription.toJSON }, timestamp, timezoneOffsetMinutes: 0, subtle: webcrypto.subtle }),
  /expiration/i
);
await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription: { ...subscription, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "bad+key", auth: "valid" } }) }, timestamp, timezoneOffsetMinutes: 0, subtle: webcrypto.subtle }),
  /p256dh/i
);
await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription: { ...subscription, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "a".repeat(129), auth: "valid" } }) }, timestamp, timezoneOffsetMinutes: 0, subtle: webcrypto.subtle }),
  /p256dh/i
);
await assert.rejects(
  createPushSubscriptionRecord({ uid: "user-a", subscription: { ...subscription, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "valid", auth: "a".repeat(65) } }) }, timestamp, timezoneOffsetMinutes: 0, subtle: webcrypto.subtle }),
  /auth/i
);

console.log("Push subscription policy passed");
