export const ACTIVITY_WRITE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const INACTIVITY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

const millis = (timestamp) => {
  if (typeof timestamp?.toMillis === "function") return timestamp.toMillis();
  if (timestamp instanceof Date) return timestamp.getTime();
  return undefined;
};

export const activityStatus = (lastActiveAt, now = Date.now()) => {
  const lastActiveMillis = millis(lastActiveAt);
  if (!Number.isFinite(lastActiveMillis)) return "unknown";
  return now - lastActiveMillis > INACTIVITY_INTERVAL_MS ? "inactive" : "active";
};

export const isActivityWriteDue = (lastActiveAt, now = Date.now()) => {
  const lastActiveMillis = millis(lastActiveAt);
  return !Number.isFinite(lastActiveMillis) || now - lastActiveMillis >= ACTIVITY_WRITE_INTERVAL_MS;
};
