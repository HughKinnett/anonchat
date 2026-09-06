const STATE_COLLECTION = "systemState";
const STATE_DOCUMENT = "badgeReconciliation";
const CURSOR_FIELDS = Object.freeze({
  identity: "identityCursor",
  activity: "activityCursor"
});

const fieldFor = (kind) => {
  const field = CURSOR_FIELDS[kind];
  if (!field) throw new Error("Unknown badge reconciliation kind.");
  return field;
};

const stateRef = (db) => db.collection(STATE_COLLECTION).doc(STATE_DOCUMENT);

export const loadBadgeReconciliationCursor = async ({ db, kind }) => {
  if (!db) throw new Error("Firestore database is required.");
  const field = fieldFor(kind);
  const snapshot = await stateRef(db).get();
  if (!snapshot.exists) return null;
  const value = snapshot.data()?.[field];
  return typeof value === "string" && value ? value : null;
};

export const saveBadgeReconciliationCursor = async ({ db, kind, cursor }) => {
  if (!db) throw new Error("Firestore database is required.");
  const field = fieldFor(kind);
  await stateRef(db).set({ [field]: typeof cursor === "string" && cursor ? cursor : null }, { merge: true });
};
