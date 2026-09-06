import { normalizeUserSettings } from "./user-settings-policy.mjs";

export const userSettingsPath = (uid) => ["users", uid, "private", "settings"];

export const loadUserSettings = async (db, uid, firestore = {}) => {
  if (!db || !uid) return normalizeUserSettings();
  const { doc, getDoc } = firestore;
  if (typeof doc !== "function" || typeof getDoc !== "function") return normalizeUserSettings();
  try {
    const snapshot = await getDoc(doc(db, ...userSettingsPath(uid)));
    return normalizeUserSettings(snapshot?.exists?.() ? snapshot.data() : undefined);
  } catch {
    return normalizeUserSettings();
  }
};

export const saveUserSettings = async (db, uid, partial, firestore = {}) => {
  if (!db || !uid) throw new Error("Database and user are required.");
  const { doc, getDoc, setDoc } = firestore;
  if (typeof doc !== "function" || typeof setDoc !== "function") throw new Error("Firestore document helpers are required.");
  let current = normalizeUserSettings();
  if (typeof getDoc === "function") {
    try {
      const snapshot = await getDoc(doc(db, ...userSettingsPath(uid)));
      if (snapshot?.exists?.()) current = normalizeUserSettings(snapshot.data());
    } catch {}
  }
  const incoming = partial && typeof partial === "object" ? partial : {};
  const merged = normalizeUserSettings({
    ...current,
    ...incoming,
    notifications: { ...current.notifications, ...(incoming.notifications || {}) },
    quietHours: { ...current.quietHours, ...(incoming.quietHours || {}) }
  });
  await setDoc(doc(db, ...userSettingsPath(uid)), merged, { merge: false });
  return merged;
};
