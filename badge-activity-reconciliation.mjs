import { processBadgeAwards } from "./badge-award-processor.mjs";

export const ACTIVITY_BADGE_BATCH_SIZE = 25;
export const ACTIVITY_BADGE_MAX_BATCHES = 4;

const has = (earned, badgeId) => earned instanceof Set && earned.has(badgeId);

export const reconcileActivityBadges = async ({
  adapter,
  batchSize = ACTIVITY_BADGE_BATCH_SIZE,
  maxBatches = ACTIVITY_BADGE_MAX_BATCHES,
  startCursor = null
}) => {
  if (!adapter?.listUsersPage) throw new Error("Activity badge adapter is required.");
  const safeBatchSize = Math.max(1, Math.min(ACTIVITY_BADGE_BATCH_SIZE, Math.floor(Number(batchSize) || ACTIVITY_BADGE_BATCH_SIZE)));
  const safeMaxBatches = Math.max(1, Math.min(ACTIVITY_BADGE_MAX_BATCHES, Math.floor(Number(maxBatches) || ACTIVITY_BADGE_MAX_BATCHES)));
  let cursor = startCursor;
  let inspected = 0;
  let evaluated = 0;
  let batches = 0;

  while (batches < safeMaxBatches) {
    const page = await adapter.listUsersPage({ limit: safeBatchSize, cursor });
    const users = Array.isArray(page?.users) ? page.users : [];
    if (!users.length) return { inspected, evaluated, batches, nextCursor: null };
    batches += 1;

    for (const user of users) {
      if (!user?.id) continue;
      inspected += 1;
      const earned = await adapter.listEarnedBadgeIds(user.id);
      const changedMetrics = [];
      const metrics = {};

      if (!has(earned, "top-contributor")) {
        metrics.posts_created = await adapter.countPostsCreated(user.id);
        changedMetrics.push("posts_created");
      }
      if (!has(earned, "community-helper")) {
        metrics.comments_or_replies_created = await adapter.countCommentsOrRepliesCreated(user.id);
        changedMetrics.push("comments_or_replies_created");
      }
      if (!has(earned, "popular-post-creator")) {
        metrics.single_post_interactions = await adapter.maxPostInteractions(user.id, 100);
        changedMetrics.push("single_post_interactions");
      }

      if (changedMetrics.length) {
        await processBadgeAwards({ adapter, uid: user.id, changedMetrics, metrics });
      }
      evaluated += 1;
    }

    cursor = page?.nextCursor ?? null;
    if (!cursor) return { inspected, evaluated, batches, nextCursor: null };
  }

  return { inspected, evaluated, batches, nextCursor: cursor };
};
