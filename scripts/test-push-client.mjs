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
  const harness = makeHarness({ permission: "granted", existing: makeSubscription(), failSave: true });
  await assert.doesNotReject(harness.client.reconcileExisting({ uid: "user-a" }), "storage failures do not crash timeline startup");
  assert.equal(harness.states.at(-1), "retry");
  const exposed = [...harness.states.map((state) => PUSH_ALERT_MESSAGES[state]), ...harness.logs].join(" ");
  assert.equal(exposed.includes(endpoint), false, "endpoint material is absent from UI and logs");
  assert.equal(exposed.includes("valid_p256dh"), false, "key material is absent from UI and logs");
  assert.equal(exposed.includes("valid_auth"), false, "auth material is absent from UI and logs");
}

console.log("Push alerts client passed");
