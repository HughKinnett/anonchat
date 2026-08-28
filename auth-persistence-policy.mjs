export const chooseDurablePersistence = async (setPersistenceFn, auth, candidates) => {
  const [localPersistence, sessionPersistence] = candidates;

  for (const persistence of [localPersistence, sessionPersistence]) {
    try {
      await setPersistenceFn(auth, persistence);
      return persistence;
    } catch {
      // Try the other browser-backed store before reporting that both are unavailable.
    }
  }

  const error = new Error("Browser storage is unavailable for durable authentication.");
  error.code = "auth/storage-unavailable";
  throw error;
};
