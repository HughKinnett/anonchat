import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || "anonchatlogin";
const app = getApps()[0] || initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);
const launchRef = db.doc("system/premiumLaunch");
const founderHandles = new Set(["i_love_you_h", "cybercapone", "ownercybercapone"]);

let launch = await launchRef.get();
if (!launch.exists) {
  await launchRef.create({ priceUsd: 4.99, mode: "stripe_test", launchedAt: FieldValue.serverTimestamp() });
  launch = await launchRef.get();
}
const cutoff = launch.data().launchedAt;
if (!cutoff) throw new Error("Premium launch cutoff is unavailable.");

const users = await db.collection("users").get();
const existingAccess = new Set((await db.collection("premiumAccess").select().get()).docs.map(doc => doc.id));
let batch = db.batch(), writes = 0, total = 0;
for (const user of users.docs) {
  const data = user.data();
  if (data.createdAt?.toMillis?.() > cutoff.toMillis()) continue;
  const handle = String(data.username || "").toLowerCase();
  const tier = founderHandles.has(handle) ? "founder" : "founding";
  const entitlement = db.doc(`premiumAccess/${user.id}`);
  if (existingAccess.has(user.id)) continue;
  batch.create(entitlement, {
    uid: user.id, tier, status: "active", source: "launch_grant",
    startedAt: cutoff, updatedAt: cutoff
  });
  writes += 1; total += 1;
  if (writes === 400) { await batch.commit(); batch = db.batch(); writes = 0; }
}
if (writes) await batch.commit();
console.log(`PREMIUM_FOUNDING_BACKFILL_COMPLETE created=${total}`);
