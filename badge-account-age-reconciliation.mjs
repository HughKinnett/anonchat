import { processBadgeAwards } from "./badge-award-processor.mjs";
import { EARLY_MEMBER_CUTOFF, FOUNDING_MEMBER_CUTOFF } from "./badge-milestones.mjs";
import { isAnonChatFounder } from "./founder-identities.mjs";
import { isProtectedAdministrator } from "./admin-deletion-policy.mjs";

export const ACCOUNT_AGE_BATCH_SIZE = 100;
export const ACCOUNT_AGE_MAX_BATCHES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const timestampMillis = (value) => {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isPaidSubscriber = (premium = {}) => premium.status === "active" && premium.tier === "subscriber";
const isEarlyPaidSupporter = (premium = {}) => {
  if (!isPaidSubscriber(premium)) return false;
  const startedAt = timestampMillis(premium.startedAt);
  return Number.isFinite(startedAt) && startedAt <= EARLY_MEMBER_CUTOFF;
};

export const reconcileAccountAgeBadges = async ({
  adapter,
  now = Date.now(),
  batchSize = ACCOUNT_AGE_BATCH_SIZE,
  maxBatches = ACCOUNT_AGE_MAX_BATCHES,
  startCursor = null
}) => {
  if (!adapter?.db) throw new Error("Badge award adapter with Firestore database is required.");
  const safeBatchSize = Math.max(1, Math.min(ACCOUNT_AGE_BATCH_SIZE, Math.floor(Number(batchSize) || ACCOUNT_AGE_BATCH_SIZE)));
  const safeMaxBatches = Math.max(1, Math.min(ACCOUNT_AGE_MAX_BATCHES, Math.floor(Number(maxBatches) || ACCOUNT_AGE_MAX_BATCHES)));
  let cursor = startCursor;
  let inspected = 0;
  let evaluated = 0;
  let batches = 0;

  while (batches < safeMaxBatches) {
    let query = adapter.db.collection("users").orderBy("__name__").limit(safeBatchSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) return { inspected, evaluated, batches, nextCursor: null };

    batches += 1;
    for (const document of snapshot.docs) {
      inspected += 1;
      const profile = document.data() || {};
      const createdAt = timestampMillis(profile.createdAt);
      if (!Number.isFinite(createdAt)) continue;
      const premiumSnapshot = await adapter.db.collection("premiumAccess").doc(document.id).get();
      const premium = premiumSnapshot.exists ? premiumSnapshot.data() || {} : {};
      const accountAgeDays = Math.max(0, Math.floor((now - createdAt) / DAY_MS));
      const metrics = {
        account_age_days: accountAgeDays,
        account_created_at_ms: createdAt,
        founder: isAnonChatFounder(profile.username),
        founding_member: createdAt <= FOUNDING_MEMBER_CUTOFF,
        early_member: createdAt <= EARLY_MEMBER_CUTOFF,
        early_supporter: isEarlyPaidSupporter(premium),
        verified_admin: isProtectedAdministrator(profile.username),
        verified_moderator: false,
        premium_active: isPaidSubscriber(premium)
      };
      await processBadgeAwards({
        adapter,
        uid: document.id,
        changedMetrics: [
          "founder",
          "founding_member",
          "early_member",
          "early_supporter",
          "verified_admin",
          "verified_moderator",
          "premium_active",
          "account_age_days"
        ],
        metrics
      });
      evaluated += 1;
    }

    cursor = snapshot.docs.at(-1)?.id ?? null;
    if (snapshot.size < safeBatchSize) return { inspected, evaluated, batches, nextCursor: null };
  }

  return { inspected, evaluated, batches, nextCursor: cursor };
};
