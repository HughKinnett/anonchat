const storageKey = (uid) => `anonchat-seen-notifications-${uid}`;

export function readSeenNotificationIds({ storage, uid }) {
  try {
    const parsed = JSON.parse(storage.getItem(storageKey(uid)) || "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function markNotificationsSeen({ storage, uid, seenIds, currentIds }) {
  currentIds.forEach((id) => seenIds.add(id));
  try {
    storage.setItem(storageKey(uid), JSON.stringify([...seenIds]));
  } catch {
    // In-memory bell state remains usable when browser storage is unavailable.
  }
}
