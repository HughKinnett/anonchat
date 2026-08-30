import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createPushAlertsClient, PUSH_ALERT_MESSAGES } from "../push-client.mjs";

const endpoint = "https://push.example/private/device-token";
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url");
const makeSubscription = () => ({
  endpoint,
  expirationTime: null,
  toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "valid_p256dh", auth: "valid_auth" } })
});

const makeHarness = ({ permission = "default", existing = null, configuredKey = publicKey, failSave = false } = {}) => {
  const states = [];
  const logs = [];
  const saved = [];
  const calls = { permission: 0, get: 0, subscribe: 0 };
  let current = existing;
  const notification = {
    permission,
    async requestPermission() {
      calls.permission += 1;
      this.permission = "granted";
      return "granted";
    }
  };
  const pushManager = {
    async getSubscription() {
      calls.get += 1;
      return current;
    },
    async subscribe(options) {
      calls.subscribe += 1;
      assert.equal(options.userVisibleOnly, true);
      assert.equal(options.applicationServerKey instanceof Uint8Array, true);
      current = makeSubscription();
      return current;
    }
  };
  const client = createPushAlertsClient({
    notification,
    serviceWorkerSupported: true,
    pushSupported: true,
    serviceWorkerReady: Promise.resolve({ pushManager }),
    publicKey: configuredKey,
    subtle: webcrypto.subtle,
    timestamp: () => ({ sentinel: "serverTimestamp" }),
    persist: async (record) => {
      if (failSave) throw new Error(`storage rejected ${endpoint}`);
      saved.push(record);
    },
    onState: (state) => states.push(state),
    logger: { error: (...values) => logs.push(values.join(" ")) }
  });
  return { client, states, logs, saved, calls, notification };
};

{
  const harness = makeHarness();
  await harness.client.reconcileExisting({ uid: "user-a" });
  assert.equal(harness.calls.permission, 0, "visits never prompt for notification permission");
  assert.equal(harness.calls.subscribe, 0, "visits never silently create a browser subscription");
  await harness.client.enableFromGesture({ uid: "user-a" });
  assert.equal(harness.calls.permission, 1, "the explicit enable action requests permission once");
  assert.equal(harness.calls.subscribe, 1);
  assert.equal(harness.saved.length, 1);
  assert.equal(harness.states.at(-1), "enabled");
}

{
  const existing = makeSubscription();
  const harness = makeHarness({ permission: "granted", existing });
  await harness.client.reconcileExisting({ uid: "user-a" });
  assert.equal(harness.calls.permission, 0);
  assert.equal(harness.calls.subscribe, 0, "an existing device subscription is reused, not duplicated");
  assert.equal(harness.saved.length, 1, "existing browser state is reconciled with Firestore");
  assert.equal(harness.saved[0].data.endpoint, endpoint);
  assert.equal(harness.states.at(-1), "enabled");
}

{
  const harness = makeHarness({ configuredKey: "" });
  await harness.client.enableFromGesture({ uid: "user-a" });
  assert.equal(harness.calls.permission, 0, "an unconfigured deployment does not prompt or subscribe");
  assert.equal(harness.calls.get, 0);
  assert.equal(harness.states.at(-1), "configuration-pending");
}

{
  const states = [];
  const logs = [];
  const client = createPushAlertsClient({
    notification: { permission: "granted", requestPermission: async () => "granted" },
    serviceWorkerSupported: true,
    pushSupported: true,
    serviceWorkerReady: Promise.resolve({
      update: async () => {},
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => {
          const error = new Error("private browser detail");
          error.name = "AbortError";
          throw error;
        }
      }
    }),
    publicKey,
    isAndroid: true,
    subtle: webcrypto.subtle,
    timestamp: () => ({ sentinel: "serverTimestamp" }),
    persist: async () => {},
    onState: (state) => states.push(state),
    logger: { error: (...values) => logs.push(values.join(" ")) }
  });
  await client.enableFromGesture({ uid: "user-a" });
  assert.equal(states.at(-1), "device-settings", "Android subscription failures give actionable device-setting guidance");
  assert.equal(logs.join(" ").includes("private browser detail"), false, "Android diagnostics never expose browser error details");
}

{
  const harness = makeHarness({ permission: "granted", existing: makeSubscription(), failSave: true });
  await assert.doesNotReject(harness.client.reconcileExisting({ uid: "user-a" }), "storage failures do not crash timeline startup");
  assert.equal(harness.states.at(-1), "retry");
  const exposed = [...harness.states.map((state) => PUSH_ALERT_MESSAGES[state]), ...harness.logs].join(" ");
  assert.equal(exposed.includes(endpoint), false, "endpoint material is absent from UI and logs");
  assert.equal(exposed.includes("valid_p256dh"), false, "key material is absent from UI and logs");
  assert.equal(exposed.includes("valid_auth"), false, "auth material is absent from UI and logs");
}

{
  let currentOwner = "user-a";
  let currentSubscription;
  let subscriptionNumber = 0;
  const unsubscribed = [];
  const states = [];
  const makeOwnedSubscription = (label) => {
    const ownedEndpoint = `https://push.example/private/${label}`;
    const subscription = {
      endpoint: ownedEndpoint,
      expirationTime: null,
      toJSON: () => ({ endpoint: ownedEndpoint, expirationTime: null, keys: { p256dh: `p256dh_${label}`, auth: `auth_${label}` } }),
      async unsubscribe() {
        unsubscribed.push(label);
        if (currentSubscription === subscription) currentSubscription = null;
        return true;
      }
    };
    return subscription;
  };
  currentSubscription = makeOwnedSubscription("account-a");
  const client = createPushAlertsClient({
    notification: { permission: "granted", requestPermission: async () => "granted" },
    serviceWorkerSupported: true,
    pushSupported: true,
    serviceWorkerReady: Promise.resolve({
      pushManager: {
        getSubscription: async () => currentSubscription,
        subscribe: async () => {
          subscriptionNumber += 1;
          currentSubscription = makeOwnedSubscription(`account-b-${subscriptionNumber}`);
          return currentSubscription;
        }
      }
    }),
    publicKey,
    subtle: webcrypto.subtle,
    timestamp: () => ({ sentinel: "serverTimestamp" }),
    persist: async (record) => {
      if (record.data.endpoint.endsWith("account-a") && record.data.uid !== currentOwner) {
        throw new Error(`owner conflict for ${record.data.endpoint}`);
      }
      currentOwner = record.data.uid;
    },
    remove: async () => { currentOwner = null; },
    onState: (state) => states.push(state),
    logger: { error: () => {} }
  });

  await client.reconcileExisting({ uid: "user-b" });
  assert.equal(currentSubscription, null, "passive B reconciliation removes A's origin subscription after an ownership conflict");
  assert.deepEqual(unsubscribed, ["account-a"]);
  assert.equal(subscriptionNumber, 0, "passive handoff never creates B's replacement");
  assert.equal(states.at(-1), "retry");

  await client.enableFromGesture({ uid: "user-b" });
  assert.equal(currentOwner, "user-b", "B's explicit gesture persists a fresh B subscription");
  assert.match(currentSubscription.endpoint, /account-b-1$/);
  assert.equal(subscriptionNumber, 1);

  await client.cleanupForSignOut({ uid: "user-b" });
  assert.equal(currentOwner, null, "sign-out deletes B's endpoint-derived document while still authenticated");
  assert.equal(currentSubscription, null, "sign-out always unsubscribes the origin subscription");
}

{
  let currentSubscription;
  let persistedOwner = "user-a";
  let subscribeCount = 0;
  const unsubscribed = [];
  const makeOwnedSubscription = (label) => {
    const ownedEndpoint = `https://push.example/private/${label}`;
    const subscription = {
      endpoint: ownedEndpoint,
      expirationTime: null,
      toJSON: () => ({ endpoint: ownedEndpoint, expirationTime: null, keys: { p256dh: `p256dh_${label}`, auth: `auth_${label}` } }),
      async unsubscribe() {
        unsubscribed.push(label);
        if (currentSubscription === subscription) currentSubscription = null;
        return true;
      }
    };
    return subscription;
  };
  currentSubscription = makeOwnedSubscription("stale-a");
  const client = createPushAlertsClient({
    notification: { permission: "granted", requestPermission: async () => "granted" },
    serviceWorkerSupported: true,
    pushSupported: true,
    serviceWorkerReady: Promise.resolve({
      pushManager: {
        getSubscription: async () => currentSubscription,
        subscribe: async () => {
          subscribeCount += 1;
          currentSubscription = makeOwnedSubscription("fresh-b");
          return currentSubscription;
        }
      }
    }),
    publicKey,
    subtle: webcrypto.subtle,
    timestamp: () => ({ sentinel: "serverTimestamp" }),
    persist: async (record) => {
      if (record.data.endpoint.endsWith("stale-a")) throw new Error("ownership denied");
      persistedOwner = record.data.uid;
    },
    remove: async () => {},
    onState: () => {},
    logger: { error: () => {} }
  });
  await client.enableFromGesture({ uid: "user-b" });
  assert.deepEqual(unsubscribed, ["stale-a"], "explicit B enable removes A's stale subscription first");
  assert.equal(subscribeCount, 1, "the same explicit gesture creates one fresh replacement");
  assert.equal(persistedOwner, "user-b");
  assert.match(currentSubscription.endpoint, /fresh-b$/);
}

{
  const privateEndpoint = "https://push.example/private/deletion-failure";
  let currentSubscription;
  let unsubscribeCount = 0;
  const logs = [];
  currentSubscription = {
    endpoint: privateEndpoint,
    expirationTime: null,
    toJSON: () => ({ endpoint: privateEndpoint, expirationTime: null, keys: { p256dh: "private_p256dh", auth: "private_auth" } }),
    async unsubscribe() {
      unsubscribeCount += 1;
      currentSubscription = null;
      return true;
    }
  };
  const client = createPushAlertsClient({
    notification: { permission: "granted", requestPermission: async () => "granted" },
    serviceWorkerSupported: true,
    pushSupported: true,
    serviceWorkerReady: Promise.resolve({ pushManager: { getSubscription: async () => currentSubscription } }),
    publicKey,
    subtle: webcrypto.subtle,
    timestamp: () => ({ sentinel: "serverTimestamp" }),
    persist: async () => {},
    remove: async () => { throw new Error(`delete failed ${privateEndpoint}`); },
    onState: () => {},
    logger: { error: (...values) => logs.push(values.join(" ")) }
  });
  await assert.doesNotReject(client.cleanupForSignOut({ uid: "user-a" }));
  assert.equal(unsubscribeCount, 1, "document deletion failure cannot prevent browser unsubscribe");
  assert.equal(currentSubscription, null);
  assert.equal(logs.join(" ").includes(privateEndpoint), false, "cleanup logs never expose endpoint material");
}

{
  let currentSubscription;
  let subscribeCount = 0;
  const unsubscribed = [];
  const makeFailingSubscription = (label) => {
    const failingEndpoint = `https://push.example/private/${label}`;
    const subscription = {
      endpoint: failingEndpoint,
      expirationTime: null,
      toJSON: () => ({ endpoint: failingEndpoint, expirationTime: null, keys: { p256dh: `p256dh_${label}`, auth: `auth_${label}` } }),
      async unsubscribe() {
        unsubscribed.push(label);
        if (currentSubscription === subscription) currentSubscription = null;
        return true;
      }
    };
    return subscription;
  };
  currentSubscription = makeFailingSubscription("stale-a");
  const states = [];
  const client = createPushAlertsClient({
    notification: { permission: "granted", requestPermission: async () => "granted" },
    serviceWorkerSupported: true,
    pushSupported: true,
    serviceWorkerReady: Promise.resolve({
      pushManager: {
        getSubscription: async () => currentSubscription,
        subscribe: async () => {
          subscribeCount += 1;
          currentSubscription = makeFailingSubscription("fresh-b");
          return currentSubscription;
        }
      }
    }),
    publicKey,
    subtle: webcrypto.subtle,
    timestamp: () => ({ sentinel: "serverTimestamp" }),
    persist: async () => { throw new Error("storage unavailable"); },
    remove: async () => {},
    onState: (state) => states.push(state),
    logger: { error: () => {} }
  });
  await client.enableFromGesture({ uid: "user-b" });
  assert.equal(subscribeCount, 1);
  assert.deepEqual(unsubscribed, ["stale-a", "fresh-b"], "both stale and unpersistable fresh subscriptions are privacy-first unsubscribed");
  assert.equal(currentSubscription, null, "no browser endpoint survives when B's replacement cannot be persisted");
  assert.equal(states.at(-1), "retry");
}

console.log("Push alerts client passed");
