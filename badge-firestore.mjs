import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  ANONCHAT_BADGE_CATALOG,
  normalizeBadgeAssignment
} from "./badge-policy.mjs";

export const listBadgeTypes = async () =>
  ANONCHAT_BADGE_CATALOG.map((badge) => ({ ...badge }));

export const listUserBadges = async (db, uid) => {
  if (!uid) return [];
  const snapshot = await getDocs(collection(db, "users", uid, "badges"));
  return snapshot.docs.map((entry) => normalizeBadgeAssignment(entry.data(), entry.id));
};
