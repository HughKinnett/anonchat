export function normalizePinnedPostId(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

export function canPinPost({ userUid, postAuthorUid, postExists } = {}) {
  return Boolean(postExists && userUid && postAuthorUid && userUid === postAuthorUid);
}

export function nextPinnedPostId({
  currentPinnedPostId,
  requestedPostId,
  userUid,
  postAuthorUid,
  postExists
} = {}) {
  const requested = normalizePinnedPostId(requestedPostId);
  if (requested === null) return null;
  if (!canPinPost({ userUid, postAuthorUid, postExists })) {
    throw new Error("You can only pin your own post.");
  }
  return requested;
}
