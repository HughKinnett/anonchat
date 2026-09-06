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
  let founders = 0;
  let foundingMembers = 0;
  let foundersMissingFounder = 0;
  let foundersWithFoundingMember = 0;
  let foundersMissingPremium = 0;
  let foundingMembersMissingFounding = 0;
  let foundingMembersMissingPremium = 0;
  const failures = [];

  for (const user of users.docs) {
    const profile = user.data() || {};
    const createdAt = timestampMillis(profile.createdAt);
    const founder = isAnonChatFounder(profile.username);
    const foundingMember = !founder && Number.isFinite(createdAt) && createdAt <= FOUNDING_MEMBER_CUTOFF;
    if (!founder && !foundingMember) continue;

    const [founderBadge, foundingBadge, premiumBadge] = await Promise.all([
      user.ref.collection("badges").doc("founder").get(),
      user.ref.collection("badges").doc("founding-member").get(),
      user.ref.collection("badges").doc("premium-member").get()
    ]);

    if (founder) {
      founders += 1;
      if (!founderBadge.exists) {
        foundersMissingFounder += 1;
        failures.push(`${user.id}:missing-founder`);
      }
      if (foundingBadge.exists) {
        foundersWithFoundingMember += 1;
        failures.push(`${user.id}:unexpected-founding-member`);
      }
      if (!premiumBadge.exists) {
        foundersMissingPremium += 1;
        failures.push(`${user.id}:missing-premium`);
      }
      continue;
    }

    foundingMembers += 1;
    if (!foundingBadge.exists) {
      foundingMembersMissingFounding += 1;
      failures.push(`${user.id}:missing-founding-member`);
    }
    if (!premiumBadge.exists) {
      foundingMembersMissingPremium += 1;
      failures.push(`${user.id}:missing-premium`);
    }
  }

  console.log(
    `FOUNDER_BADGE_VERIFICATION founders=${founders} foundingMembers=${foundingMembers} `
    + `foundersMissingFounder=${foundersMissingFounder} `
    + `foundersWithFoundingMember=${foundersWithFoundingMember} `
    + `foundersMissingPremium=${foundersMissingPremium} `
    + `foundingMembersMissingFounding=${foundingMembersMissingFounding} `
    + `foundingMembersMissingPremium=${foundingMembersMissingPremium}`
  );
  if (failures.length) {
    console.error(`FOUNDER_BADGE_VERIFICATION_FAILURES ${failures.join(",")}`);
    process.exitCode = 1;
  }
} finally {
  await deleteApp(app);
}
