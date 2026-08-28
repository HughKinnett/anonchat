import { createFirebaseActivityWriter, recordDailyActivity } from "./activity.js";
import { runAccessActivityGate } from "./access-activity-gate.mjs";

export const signedInActivitySurfaces = Object.freeze({
  timeline: Object.freeze({ requireAdmin: false }),
  profile: Object.freeze({ requireAdmin: false }),
  community: Object.freeze({ requireAdmin: false }),
  connections: Object.freeze({ requireAdmin: false }),
  "delete-account": Object.freeze({ requireAdmin: false }),
  admin: Object.freeze({ requireAdmin: true })
});

export const recordPageActivity = ({ surface, profile, user, db, firestore, isAuthorizedAdmin = false }) => {
  const integration = signedInActivitySurfaces[surface];
  if (!integration) throw new Error(`Unknown signed-in activity surface: ${surface}`);

  return runAccessActivityGate({
    profile,
    requireAdmin: integration.requireAdmin,
    isAuthorizedAdmin,
    recordActivity: () => recordDailyActivity({
      lastActiveAt: profile?.lastActiveAt,
      writeLastActiveAt: () => createFirebaseActivityWriter({ db, ...firestore })(user)
    })
  });
};
