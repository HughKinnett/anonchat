import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { matchingAutomaticBadges } from "./badge-milestones.mjs";

export const evaluateBadgeMilestones = async ({ db, uid, changedMetrics = [], metrics = {} }) => {
  if (!db || !uid) throw new Error("Database and user are required.");
  const definitionsSnapshot = await getDocs(query(collection(db, "badgeTypes"), where("active", "==", true)));
  const definitions = definitionsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  return matchingAutomaticBadges(definitions, metrics, changedMetrics).map((badge) => ({
    badgeId: badge.id,
    qualified: true
  }));
};
