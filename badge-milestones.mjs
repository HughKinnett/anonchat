import { ANONCHAT_BADGE_CATALOG } from "./badge-policy.mjs";

export const EARLY_MEMBER_CUTOFF = Date.parse("2026-09-05T23:59:59.999Z");

export const INITIAL_AUTOMATIC_BADGES = Object.freeze(
  ANONCHAT_BADGE_CATALOG.map((badge) => Object.freeze({
    ...badge,
    awardMode: "automatic",
    active: true
  }))
);

const finiteNumber = (value) => typeof value === "number" && Number.isFinite(value);

export const qualifiesForBadge = (definition = {}, metrics = {}) => {
  if (definition.active === false || definition.awardMode !== "automatic") return false;

  const metric = definition.milestoneMetric;
  if (metric === "premium_active") return metrics.premium_active === true;
  if (metric === "early_member") {
    if (typeof metrics.early_member === "boolean") return metrics.early_member;
    return finiteNumber(metrics.account_created_at_ms) && metrics.account_created_at_ms <= EARLY_MEMBER_CUTOFF;
  }
  if (["early_supporter", "verified_admin", "verified_moderator", "special_achievement"].includes(metric)) {
    return metrics[metric] === true;
  }

  const threshold = Number(definition.milestoneThreshold);
  const value = Number(metrics[metric]);
  return Number.isFinite(threshold) && threshold > 0 && Number.isFinite(value) && value >= threshold;
};

export const matchingAutomaticBadges = (definitions = [], metrics = {}, changedMetrics = []) => {
  const changed = new Set(Array.isArray(changedMetrics) ? changedMetrics : []);
  return definitions.filter((definition) =>
    definition?.awardMode === "automatic" &&
    definition?.active !== false &&
    changed.has(definition.milestoneMetric) &&
    qualifiesForBadge(definition, metrics)
  );
};
