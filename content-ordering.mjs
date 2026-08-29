const timestampMillis = (timestamp) => {
  try {
    const millis = typeof timestamp?.toMillis === "function"
      ? timestamp.toMillis()
      : timestamp instanceof Date
        ? timestamp.getTime()
        : timestamp;
    return Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
};

const recordData = (record) => {
  if (typeof record?.data === "function") return record.data() ?? {};
  return record?.data ?? record ?? {};
};

const recordTimestamp = (record) => timestampMillis(recordData(record)?.createdAt);

const hasPendingWrites = (record) => record?.metadata?.hasPendingWrites === true;

export const canonicalRecordPath = (record) => {
  const path = record?.ref?.path ?? record?.path;
  const segments = typeof path === "string" ? path.split("/") : [];
  if (segments.length < 2 || segments.length % 2 !== 0 || segments.some((segment) => !segment)) {
    throw new Error("record must provide a canonical path");
  }
  return path;
};

const comparePaths = (left, right) => {
  const leftPath = canonicalRecordPath(left);
  const rightPath = canonicalRecordPath(right);
  return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
};

const timestampState = (record) => {
  const millis = recordTimestamp(record);
  if (millis !== null) return { kind: "trusted", millis };
  return { kind: hasPendingWrites(record) ? "pending" : "missing", millis: null };
};

export const compareNewestFirst = (left, right) => {
  const leftState = timestampState(left);
  const rightState = timestampState(right);
  const ranks = { trusted: 0, pending: 1, missing: 2 };
  const rankDifference = ranks[leftState.kind] - ranks[rightState.kind];
  if (rankDifference !== 0) return rankDifference;
  if (leftState.kind === "trusted" && leftState.millis !== rightState.millis) {
    return rightState.millis - leftState.millis;
  }
  return comparePaths(left, right);
};

export const compareOldestFirst = (left, right) => {
  const leftState = timestampState(left);
  const rightState = timestampState(right);
  const ranks = { pending: 0, trusted: 1, missing: 2 };
  const rankDifference = ranks[leftState.kind] - ranks[rightState.kind];
  if (rankDifference !== 0) return rankDifference;
  if (leftState.kind === "trusted" && leftState.millis !== rightState.millis) {
    return leftState.millis - rightState.millis;
  }
  return comparePaths(left, right);
};
