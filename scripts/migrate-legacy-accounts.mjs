import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { migrateLegacyAccount } from "../legacy-migration-firestore-adapter.mjs";
import { parseProtectedUidMap } from "../legacy-migration-policy.mjs";

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT || "anonchatlogin"
});

const auth = getAuth();
const db = getFirestore();
const protectedUidMap = parseProtectedUidMap(process.env.ANONCHAT_PROTECTED_ADMIN_UID_MAP);

let scanned = 0;
let created = 0;
let repaired = 0;
let unchanged = 0;
let renamed = 0;

const migrateUser = async (user) => {
  const result = await migrateLegacyAccount({ db, FieldValue, user, protectedUidMap });

  if (user.displayName !== result.username) {
    await auth.updateUser(user.uid, { displayName: result.username });
    renamed += 1;
  }

  if (!result.changed) unchanged += 1;
  else if (result.existed) repaired += 1;
  else created += 1;
};

let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  for (const user of page.users) {
    scanned += 1;
    await migrateUser(user);
  }
  pageToken = page.pageToken;
} while (pageToken);

console.log(JSON.stringify({ scanned, created, repaired, unchanged, renamed }));
