import { reconcileAccountAgeBadges } from "./badge-account-age-reconciliation.mjs";
import { reconcileActivityBadges } from "./badge-activity-reconciliation.mjs";

const MAX_FULL_PASSES = 100;

const runToEnd = async ({ adapter, reconcile, label }) => {
  let cursor = null;
  let users = 0;
  let passes = 0;
  const seen = new Set();

  do {
    const result = await reconcile({ adapter, startCursor: cursor });
    users += Number(result?.evaluated || 0);
    passes += 1;
    const nextCursor = result?.nextCursor ?? null;

    if (nextCursor && (nextCursor === cursor || seen.has(nextCursor))) {
      throw new Error(`${label} cursor did not advance`);
    }
    if (nextCursor) seen.add(nextCursor);
    cursor = nextCursor;

    if (cursor && passes >= MAX_FULL_PASSES) {
      throw new Error(`${label} full reconciliation exceeded safe pass limit`);
    }
  } while (cursor);

  return { users, passes };
};

export const reconcileAllExistingUsers = async ({
  adapter,
  reconcileIdentity = reconcileAccountAgeBadges,
  reconcileActivity = reconcileActivityBadges
}) => {
  if (!adapter) throw new Error("Badge award adapter is required.");

  const identity = await runToEnd({ adapter, reconcile: reconcileIdentity, label: "Identity badge" });
  const activity = await runToEnd({ adapter, reconcile: reconcileActivity, label: "Activity badge" });

  return {
    completed: true,
    identityUsers: identity.users,
    activityUsers: activity.users,
    identityPasses: identity.passes,
    activityPasses: activity.passes,
    nextIdentityCursor: null,
    nextActivityCursor: null
  };
};
