const storageKey = (uid) => `anonchat-seen-notifications-${uid}`;

export function readSeenNotificationIds({ getStorage, uid }) {
  try {
    const storage = getStorage();
    const parsed = JSON.parse(storage.getItem(storageKey(uid)) || "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function markNotificationsSeen({ getStorage, uid, seenIds, currentIds }) {
  currentIds.forEach((id) => seenIds.add(id));
  try {
    const storage = getStorage();
    storage.setItem(storageKey(uid), JSON.stringify([...seenIds]));
  } catch {
    // In-memory bell state remains usable when browser storage is unavailable.
  }
}
