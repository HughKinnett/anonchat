import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) throw new Error("GCLOUD_PROJECT is required");

const app = initializeApp({ credential: applicationDefault(), projectId }, "totp-configurator");
try {
  await getAuth(app).projectConfigManager().updateProjectConfig({
    multiFactorConfig: {
      providerConfigs: [{
        state: "ENABLED",
        totpProviderConfig: { adjacentIntervals: 5 }
      }]
    }
  });
  const configuration = await getAuth(app).projectConfigManager().getProjectConfig();
  const provider = configuration.multiFactorConfig?.providerConfigs?.find(entry => entry.totpProviderConfig);
  if (provider?.state !== "ENABLED") throw new Error("TOTP configuration verification failed");
  console.log(`TOTP_MFA_ENABLED adjacentIntervals=${provider.totpProviderConfig.adjacentIntervals}`);
} finally {
  await deleteApp(app);
}
