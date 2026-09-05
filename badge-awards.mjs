import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { matchingAutomaticBadges } from "./badge-milestones.mjs";

export const awardBadgeIfMissing = async (db, uid, badgeId, source = "system") => {
  if (!db || !uid || !badgeId) throw new Error("Database, user, and badge are required.");
  const ref = doc(db, "users", uid, "badges", badgeId);
  const existing = await getDoc(ref);
  if (existing.exists()) return { awarded: false, reason: "already-earned" };

  await setDoc(ref, {
    badgeId,
    earnedAt: serverTimestamp(),
    assignedAt: serverTimestamp(),
    assignedBy: "system",
    awardSource: "automatic",
    featured: false
  });
  return { awarded: true, source };
};

export const evaluateBadgeMilestones = async ({ db, uid, changedMetrics = [], metrics = {} }) => {
  if (!db || !uid) throw new Error("Database and user are required.");
  const definitionsSnapshot = await getDocs(query(collection(db, "badgeTypes"), where("active", "==", true)));
  const definitions = definitionsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const matches = matchingAutomaticBadges(definitions, metrics, changedMetrics);
  const results = [];
  for (const badge of matches) {
    results.push(await awardBadgeIfMissing(db, uid, badge.id));
  }
  return results;
};
