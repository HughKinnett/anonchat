export const runAccessActivityGate = async ({
  profile,
  requireAdmin = false,
  isAuthorizedAdmin = false,
  recordActivity = async () => {}
}) => {
  if (!profile) return { allowed: false, reason: "missing-profile" };
  if (profile.banned === true) return { allowed: false, reason: "banned" };
  if (requireAdmin && !isAuthorizedAdmin) {
    return { allowed: false, reason: "unauthorized-admin" };
  }

  try {
    await recordActivity();
    return { allowed: true, activityWritten: true };
  } catch {
    return { allowed: true, activityWritten: false };
  }
};
