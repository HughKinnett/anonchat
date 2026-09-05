import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  canFeatureBadge,
  normalizeBadgeAssignment,
  normalizeBadgeType
} from "./badge-policy.mjs";

const badgeTypeRef = (db, badgeId) => doc(db, "badgeTypes", badgeId);
const userBadgeRef = (db, uid, badgeId) => doc(db, "users", uid, "badges", badgeId);

export const listBadgeTypes = async (db, { includeInactive = false } = {}) => {
  const source = includeInactive
    ? collection(db, "badgeTypes")
    : query(collection(db, "badgeTypes"), where("active", "==", true));
  const snapshot = await getDocs(source);
  return snapshot.docs.map((entry) => ({ id: entry.id, ...normalizeBadgeType(entry.data()), ...entry.data() }));
};

export const listUserBadges = async (db, uid) => {
  if (!uid) return [];
  const snapshot = await getDocs(collection(db, "users", uid, "badges"));
  return snapshot.docs.map((entry) => normalizeBadgeAssignment(entry.data(), entry.id));
};

export const saveBadgeType = async (db, badgeId, input, adminUid) => {
  const id = String(badgeId || "").trim();
  const actor = String(adminUid || "").trim();
  if (!id) throw new Error("Badge ID is required.");
  if (!actor) throw new Error("Administrator ID is required.");

  const normalized = normalizeBadgeType(input);
  if (!normalized.name) throw new Error("Badge name is required.");
  if (!normalized.description) throw new Error("Badge description is required.");

  const ref = badgeTypeRef(db, id);
  const existing = await getDoc(ref);
  const payload = {
    ...normalized,
    updatedAt: serverTimestamp()
  };

  if (existing.exists()) {
    await setDoc(ref, payload, { merge: true });
  } else {
    await setDoc(ref, {
      ...payload,
      createdAt: serverTimestamp(),
      createdBy: actor
    });
  }
  return id;
};

export const setUserBadge = async (
  db,
  uid,
  badgeId,
  adminUid,
  { featured = false, earnedAt = null, awardSource = "manual" } = {}
) => {
  const actor = String(adminUid || "").trim();
  if (!uid || !badgeId || !actor) throw new Error("User, badge, and administrator are required.");

  const ref = userBadgeRef(db, uid, badgeId);
  const existing = await getDoc(ref);
  const existingData = existing.exists() ? existing.data() : null;
  const resolvedEarnedAt = existingData?.earnedAt || earnedAt || serverTimestamp();
  const resolvedAwardSource = existingData?.awardSource || (awardSource === "automatic" ? "automatic" : "manual");

  await setDoc(ref, {
    badgeId,
    earnedAt: resolvedEarnedAt,
    assignedAt: serverTimestamp(),
    assignedBy: actor,
    awardSource: resolvedAwardSource,
    featured: existingData ? existingData.featured === true || Boolean(featured) : Boolean(featured)
  }, { merge: true });
};

export const removeUserBadge = async (db, uid, badgeId) => {
  if (!uid || !badgeId) return;
  await deleteDoc(userBadgeRef(db, uid, badgeId));
};

export const setBadgeFeatured = async (db, uid, badgeId, featured, adminUid) => {
  if (!uid || !badgeId || !adminUid) throw new Error("User, badge, and administrator are required.");
  const assignments = await listUserBadges(db, uid);
  const target = assignments.find((entry) => entry.badgeId === badgeId);
  if (!target) throw new Error("This user has not earned that badge.");
  if (featured && !canFeatureBadge(assignments, badgeId)) {
    throw new Error("A profile can feature at most 3 badges.");
  }
  await updateDoc(userBadgeRef(db, uid, badgeId), {
    featured: Boolean(featured),
    assignedBy: String(adminUid),
    assignedAt: serverTimestamp()
  });
};
