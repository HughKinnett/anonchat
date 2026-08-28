import { isActivityWriteDue } from "./activity-policy.mjs";

export const recordDailyActivity = async ({ lastActiveAt, now = () => Date.now(), writeLastActiveAt }) => {
  if (!isActivityWriteDue(lastActiveAt, now())) return { due: false, written: false };
  await writeLastActiveAt();
  return { due: true, written: true };
};

export const createFirebaseActivityWriter = ({ db, doc, updateDoc, serverTimestamp }) => (user) =>
  updateDoc(doc(db, "users", user.uid), { lastActiveAt: serverTimestamp() });
