import { pathToFileURL } from "node:url";
import { createECDH, timingSafeEqual } from "node:crypto";
import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import webPush from "web-push";
import { FirestoreNotificationAdapter } from "../notification-firestore-adapter.mjs";
import { runNotificationProcessor } from "../notification-processor.mjs";
import { VAPID_PUBLIC_KEY } from "../push-config.mjs";

const VAPID_SUBJECT = "https://anonchatlogin.web.app";
const WEB_PUSH_TIMEOUT_MS = 30_000;

export const processorConfiguration = (environment = process.env) => {
  const projectId = String(environment.GCLOUD_PROJECT ?? environment.GOOGLE_CLOUD_PROJECT ?? "").trim();
  if (projectId !== "anonchatlogin") throw new Error("INVALID_PROJECT");
  const privateKey = environment.ANONCHAT_VAPID_PRIVATE_KEY;
  if (typeof privateKey !== "string" || !privateKey) throw new Error("MISSING_VAPID_PRIVATE_KEY");
  return { projectId, privateKey };
};

export const configureWebPush = ({ subject, publicKey, privateKey, client = webPush }) => {
  if (subject !== VAPID_SUBJECT || typeof publicKey !== "string" || !publicKey
    || typeof privateKey !== "string" || !privateKey) throw new Error("INVALID_VAPID_CONFIGURATION");
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(publicKey) || !/^[A-Za-z0-9_-]+$/.test(privateKey)) throw new Error();
    const expectedPublic = Buffer.from(publicKey, "base64url");
    const privateBytes = Buffer.from(privateKey, "base64url");
    if (expectedPublic.length !== 65 || expectedPublic[0] !== 4 || privateBytes.length !== 32) throw new Error();
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(privateBytes);
    const derivedPublic = ecdh.getPublicKey(undefined, "uncompressed");
    if (!timingSafeEqual(expectedPublic, derivedPublic)) throw new Error();
    client.setVapidDetails(subject, publicKey, privateKey);
  }
  catch { throw new Error("INVALID_VAPID_CONFIGURATION"); }
  return async (subscription, payload) => {
    await client.sendNotification({
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    }, JSON.stringify(payload), { timeout: WEB_PUSH_TIMEOUT_MS });
  };
};

export const fixedResultSummary = (result) => [
  "NOTIFICATION_RESULT",
  `scanned=${result.scanned}`,
  `materialized=${result.materialized}`,
  `inspected=${result.inspected}`,
  `delivered=${result.delivered}`,
  `retried=${result.retried}`,
  `expired=${result.expired}`,
  `skipped=${result.skipped}`,
  `purged=${result.purged}`,
  `bootstrapped=${result.bootstrapped ? 1 : 0}`
].join(" ");

const createProductionRuntime = async (projectId) => {
  const app = initializeApp({ credential: applicationDefault(), projectId });
  return {
    adapter: new FirestoreNotificationAdapter({
      db: getFirestore(app), Timestamp, FieldPath, FieldValue
    }),
    close: () => deleteApp(app)
  };
};

export const main = async (argumentsList = process.argv.slice(2), dependencies = {}) => {
  if (argumentsList.length) throw new Error("INVALID_ARGUMENT");
  const configuration = processorConfiguration(dependencies.env ?? process.env);
  const sendPush = (dependencies.configurePush ?? configureWebPush)({
    subject: VAPID_SUBJECT,
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: configuration.privateKey
  });
  const runtime = await (dependencies.createRuntime ?? createProductionRuntime)(configuration.projectId);
  try {
    return await (dependencies.processor ?? runNotificationProcessor)({
      adapter: runtime.adapter,
      ownerId: (dependencies.ownerIdFactory ?? (() => `notification-${crypto.randomUUID()}`))(),
      sendPush,
      logger: dependencies.logger ?? console
    });
  } finally {
    await runtime.close?.();
  }
};

const directlyExecuted = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (directlyExecuted) main()
  .then((result) => { console.log(fixedResultSummary(result)); })
  .catch(() => { console.error("NOTIFICATION_PROCESSOR_FATAL"); process.exitCode = 1; });
