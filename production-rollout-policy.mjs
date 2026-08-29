const coded = (code) => Object.assign(new Error(code), { code });

export const gcloudCompositeIndexListArguments = (projectId) => [
  "firestore", "indexes", "composite", "list",
  "--project", projectId,
  "--database", "(default)",
  "--format=json"
];

const collectionGroupFromName = (name) => {
  if (typeof name !== "string") return "";
  const match = name.match(/\/collectionGroups\/([^/]+)\/indexes\//);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); } catch { return ""; }
};
const sameField = (left, right) => left?.fieldPath === right?.fieldPath
  && left?.order === right?.order
  && left?.arrayConfig === right?.arrayConfig;
const matchesFields = (required, actual) => {
  if (!Array.isArray(required) || !Array.isArray(actual)) return false;
  if (actual.length === required.length) return actual.every((field, index) => sameField(field, required[index]));
  return actual.length === required.length + 1
    && actual.at(-1)?.fieldPath === "__name__"
    && required.at(-1)?.fieldPath !== "__name__"
    && required.every((field, index) => sameField(field, actual[index]));
};
const matchesRequiredIndex = (required, actual) =>
  collectionGroupFromName(actual?.name) === required?.collectionGroup
  && actual?.queryScope === required?.queryScope
  && matchesFields(required?.fields, actual?.fields);

export const requiredIndexesReady = (requiredIndexes, remoteIndexes) =>
  Array.isArray(requiredIndexes) && Array.isArray(remoteIndexes)
  && requiredIndexes.every((required) => remoteIndexes.some((remote) =>
    remote?.state === "READY" && matchesRequiredIndex(required, remote)));

export const waitForRequiredIndexes = async ({
  requiredIndexes,
  listIndexes,
  timeoutMs,
  pollIntervalMs = 15_000,
  now = Date.now,
  sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
}) => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 3_600_000
    || !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) throw coded("INVALID_INDEX_WAIT_BOUND");
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const remoteIndexes = await listIndexes({ timeoutMs: Math.min(60_000, Math.max(1, deadline - now())) });
    if (requiredIndexesReady(requiredIndexes, remoteIndexes)) return;
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleep(Math.min(pollIntervalMs, remaining));
  }
  throw coded("INDEX_READINESS_TIMEOUT");
};

const nonnegativeInteger = (value) => Number.isInteger(value) && value >= 0;
export const assertSettledModerationResult = (result) => {
  if (!result || !nonnegativeInteger(result.failed) || !nonnegativeInteger(result.skipped)
    || !nonnegativeInteger(result.roomLifecycleDeferred)
    || result.failed !== 0 || result.skipped !== 0 || result.roomLifecycleDeferred !== 0) {
    throw coded("MODERATION_ROLLOUT_UNSETTLED");
  }
};

const timestampMillis = (value) => {
  try { return value?.toMillis?.(); } catch { return Number.NaN; }
};
export const verifyProductionRolloutState = (state, { nowMs = Date.now(), maxHeartbeatAgeMs = 10 * 60 * 1000 } = {}) => {
  const markerReady = (marker) => marker?.status === "completed" && Number.isFinite(timestampMillis(marker.completedAt));
  const heartbeatMillis = timestampMillis(state?.moderationProcessor?.updatedAt);
  const heartbeatAge = nowMs - heartbeatMillis;
  if (!markerReady(state?.moderationStateBackfill)
    || !markerReady(state?.roomLifecycleBackfill)
    || state?.moderationProcessor?.status !== "completed"
    || !Number.isFinite(heartbeatAge) || heartbeatAge < -60_000 || heartbeatAge > maxHeartbeatAgeMs) {
    throw coded("PRODUCTION_ROLLOUT_NOT_READY");
  }
};
