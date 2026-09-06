import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { readFile } from "node:fs/promises";

// Regression coverage for the production New Registrations admin toggle.
const env = await initializeTestEnvironment({
  projectId: "anonchat-registration-toggle-test",
  firestore: { rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8") }
});

const seed = async enabled => env.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  await setDoc(doc(db, "siteSettings", "features"), { registrationsEnabled: enabled });
  await setDoc(doc(db, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) });
});

const signup = async (uid, username) => {
  const db = env.authenticatedContext(uid, { email_verified: false }).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, "usernames", username.toLowerCase()), { uid, username, createdAt: serverTimestamp() });
  batch.set(doc(db, "users", uid), { uid, username, createdAt: serverTimestamp(), lastActiveAt: serverTimestamp() });
  batch.update(doc(db, "system", "accountStats"), { count: 6, limit: 500, updatedAt: serverTimestamp() });
  return batch.commit();
};

try {
  await seed(true);
  await assertSucceeds(signup("new-user", "New_User"));
  await env.clearFirestore();
  await seed(false);
  await assertFails(signup("blocked-user", "Blocked_User"));
  console.log("registration toggle regression passed");
} finally {
  await env.cleanup();
}
