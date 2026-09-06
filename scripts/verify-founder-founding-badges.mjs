import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { isAnonChatFounder } from "../founder-identities.mjs";
import { FOUNDING_MEMBER_CUTOFF } from "../badge-milestones.mjs";

const timestampMillis = (value) => {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "anonchatlogin";
const app = initializeApp({ credential: applicationDefault(), projectId }, `verify-founder-badges-${Date.now()}`);

try {
  const db = getFirestore(app);
  const users = await db.collection("users").get();
  const missing = [];
  let founders = 0;
  let foundingMembers = 0;

  for (const user of users.docs) {
    const profile = user.data() || {};
    const createdAt = timestampMillis(profile.createdAt);
    const founder = isAnonChatFounder(profile.username);
    const foundingMember = Number.isFinite(createdAt) && createdAt <= FOUNDING_MEMBER_CUTOFF;

    if (founder) {
      founders += 1;
      const badge = await user.ref.collection("badges").doc("founder").get();
      if (!badge.exists) missing.push(`${user.id}:founder`);
    }

    if (foundingMember) {
      foundingMembers += 1;
      const badge = await user.ref.collection("badges").doc("founding-member").get();
      if (!badge.exists) missing.push(`${user.id}:founding-member`);
    }
  }

  console.log(`FOUNDER_BADGE_VERIFICATION founders=${founders} foundingMembers=${foundingMembers} missing=${missing.length}`);
  if (missing.length) {
    console.error(`FOUNDER_BADGE_VERIFICATION_MISSING ${missing.join(",")}`);
    process.exitCode = 1;
  }
} finally {
  await deleteApp(app);
}
