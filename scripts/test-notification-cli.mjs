import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { configureWebPush, fatalErrorSummary, fixedResultSummary, main, processorConfiguration } from "./notification-processor.mjs";

assert.throws(() => processorConfiguration({ GCLOUD_PROJECT: "anonchatlogin" }), /MISSING_VAPID_PRIVATE_KEY/);
assert.throws(() => processorConfiguration({ GCLOUD_PROJECT: "wrong", ANONCHAT_VAPID_PRIVATE_KEY: "synthetic" }), /INVALID_PROJECT/);
assert.deepEqual(processorConfiguration({ GCLOUD_PROJECT: "anonchatlogin", ANONCHAT_VAPID_PRIVATE_KEY: "synthetic" }), {
  projectId: "anonchatlogin",
  privateKey: "synthetic"
});

const vapid = createECDH("prime256v1");
vapid.generateKeys();
const testPublicKey = vapid.getPublicKey().toString("base64url");
const testPrivateKey = vapid.getPrivateKey().toString("base64url");
let configuredVapid = false;
let sendArguments;
const send = configureWebPush({
  subject: "https://anonchatlogin.web.app",
  publicKey: testPublicKey,
  privateKey: testPrivateKey,
  client: {
    setVapidDetails: () => { configuredVapid = true; },
    sendNotification: async (...args) => { sendArguments = args; }
  }
});
assert.equal(configuredVapid, true);
await send({ endpoint: "https://push.example/test", p256dh: "key", auth: "auth" }, { type: "reaction" });
assert.deepEqual(sendArguments, [
  { endpoint: "https://push.example/test", keys: { p256dh: "key", auth: "auth" } },
  JSON.stringify({ type: "reaction" }),
  { timeout: 30_000 }
], "every production Web Push request has the exact 30-second socket timeout supported by web-push 3.6.7");
const otherVapid = createECDH("prime256v1");
otherVapid.generateKeys();
assert.throws(() => configureWebPush({
  subject: "https://anonchatlogin.web.app",
  publicKey: testPublicKey,
  privateKey: otherVapid.getPrivateKey().toString("base64url"),
  client: { setVapidDetails() {} }
}), /INVALID_VAPID_CONFIGURATION/);
assert.throws(() => configureWebPush({
  subject: "https://anonchatlogin.web.app", publicKey: "invalid", privateKey: "invalid",
  client: { setVapidDetails() {} }
}), /INVALID_VAPID_CONFIGURATION/);

const result = { bootstrapped: false, scanned: 5, materialized: 5, inspected: 5, delivered: 4, retried: 1, expired: 1, skipped: 0, purged: 2 };
assert.equal(fixedResultSummary(result), "NOTIFICATION_RESULT scanned=5 materialized=5 inspected=5 delivered=4 retried=1 expired=1 skipped=0 purged=2 bootstrapped=0");
assert.equal(fatalErrorSummary(new Error("MISSING_VAPID_PRIVATE_KEY")), "NOTIFICATION_PROCESSOR_FATAL code=MISSING_VAPID_PRIVATE_KEY");
assert.equal(fatalErrorSummary(new Error("INVALID_VAPID_CONFIGURATION")), "NOTIFICATION_PROCESSOR_FATAL code=INVALID_VAPID_CONFIGURATION");
assert.equal(fatalErrorSummary(Object.assign(new Error("database details must stay private"), { code: 7 })), "NOTIFICATION_PROCESSOR_FATAL code=RUNTIME_7");
assert.equal(fatalErrorSummary(new Error("synthetic-private-value-that-must-not-be-logged")), "NOTIFICATION_PROCESSOR_FATAL code=RUNTIME_ERROR");

let configured;
let invocation;
let closed = false;
const returned = await main([], {
  env: { GCLOUD_PROJECT: "anonchatlogin", ANONCHAT_VAPID_PRIVATE_KEY: "synthetic-private-test-value" },
  configurePush: ({ subject, publicKey, privateKey }) => {
    configured = { subject, publicKeyPresent: Boolean(publicKey), privateKeyPresent: Boolean(privateKey) };
    return async () => {};
  },
  createRuntime: async (projectId) => ({ adapter: { projectId }, close: async () => { closed = true; } }),
  processor: async (parameters) => { invocation = parameters; return result; },
  ownerIdFactory: () => "fixed-owner",
  logger: { info() {}, error() {} }
});
assert.deepEqual(configured, {
  subject: "https://anonchatlogin.web.app",
  publicKeyPresent: true,
  privateKeyPresent: true
});
assert.equal(invocation.adapter.projectId, "anonchatlogin");
assert.equal(invocation.ownerId, "fixed-owner");
assert.equal(typeof invocation.sendPush, "function");
assert.equal(closed, true);
assert.deepEqual(returned, result);
await assert.rejects(() => main(["--unsafe"], {}), /INVALID_ARGUMENT/);

const secret = "synthetic-private-value-that-must-not-be-logged";
const logged = [];
await assert.rejects(() => main([], {
  env: { GCLOUD_PROJECT: "anonchatlogin", ANONCHAT_VAPID_PRIVATE_KEY: secret },
  configurePush: () => { throw new Error(secret); },
  logger: { info: (value) => logged.push(value), error: (value) => logged.push(value) }
}));
assert.equal(logged.join(" ").includes(secret), false);
assert.equal(fatalErrorSummary(new Error(secret)).includes(secret), false);

console.log("Notification direct CLI contract passed");
