import { matchingAutomaticBadges } from "./badge-milestones.mjs";

export const processBadgeAwards = async ({ adapter, uid, changedMetrics = [], metrics = {} }) => {
  if (!adapter || !uid) throw new Error("Badge award adapter and user are required.");
  const definitions = await adapter.listActiveDefinitions();
  const matches = matchingAutomaticBadges(definitions, metrics, changedMetrics);
  const results = [];
  for (const badge of matches) {
    const result = await adapter.awardIfMissing(uid, badge.id);
    results.push(result?.reason === "already-earned"
      ? { awarded: false, badgeId: badge.id, reason: "already-earned" }
      : { ...result, badgeId: badge.id });
  }
  return results;
};
