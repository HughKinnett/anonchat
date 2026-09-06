export const chooseDurablePersistence = async (setPersistenceFn, auth, candidates) => {
  for (const persistence of candidates) {
    try {
      await setPersistenceFn(auth, persistence);
      return persistence;
    } catch {
      // Try the next available persistence mode before reporting failure.
    }
  }

  const error = new Error("Authentication storage is unavailable.");
  error.code = "auth/storage-unavailable";
  throw error;
};
