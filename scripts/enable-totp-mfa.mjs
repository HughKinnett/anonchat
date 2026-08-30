import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

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
  console.log("TOTP_MFA_DISABLED");
} finally {
  await deleteApp(app);
}
