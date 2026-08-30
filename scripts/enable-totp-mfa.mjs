import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) throw new Error("GCLOUD_PROJECT is required");

const app = initializeApp({ credential: applicationDefault(), projectId }, "totp-configurator");
try {
  await getAuth(app).projectConfigManager().updateProjectConfig({
    multiFactorConfig: {
      providerConfigs: [{
        state: "DISABLED",
        totpProviderConfig: { adjacentIntervals: 5 }
      }]
    }
  });
  const configuration = await getAuth(app).projectConfigManager().getProjectConfig();
  const provider = configuration.multiFactorConfig?.providerConfigs?.find(entry => entry.totpProviderConfig);
  if (provider?.state !== "DISABLED") throw new Error("TOTP disable verification failed");
  for (const username of ["i_love_you_h", "cybercapone"]) {
    const reservation = await getFirestore(app).doc(`usernames/${username}`).get();
    const uid = reservation.data()?.uid;
    if (!uid) continue;
    const user = await getAuth(app).getUser(uid);
    if (user.multiFactor?.enrolledFactors?.length) {
      await getAuth(app).updateUser(uid, { multiFactor: { enrolledFactors: [] } });
      console.log(`ADMIN_MFA_ENROLLMENTS_CLEARED username=${username}`);
    }
  }
  console.log("TOTP_MFA_DISABLED");
} finally {
  await deleteApp(app);
}
