import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createPushAlertsClient } from "../push-client.mjs";

const states = [];
let timeoutDelay;
const client = createPushAlertsClient({
  notification: { permission: "granted", requestPermission: async () => "granted" },
  serviceWorkerSupported: true,
  pushSupported: true,
  serviceWorkerReady: new Promise(() => {}),
  publicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString("base64url"),
  subtle: webcrypto.subtle,
  timestamp: () => ({ sentinel: "serverTimestamp" }),
  persist: async () => {},
  remove: async () => {},
  onState: (state) => states.push(state),
  readinessTimeoutMs: 250,
  setTimeoutFn: (callback, delay) => {
    timeoutDelay = delay;
    queueMicrotask(callback);
    return 1;
  },
  clearTimeoutFn: () => {},
  logger: { error: () => {} }
});

await client.enableFromGesture({ uid: "user-a" });
assert.equal(timeoutDelay, 250, "service-worker readiness uses the configured finite bound");
assert.deepEqual(states, ["enabling", "retry"], "a stuck registration leaves enabling in the retryable state");

console.log("Push readiness timeout passed");
