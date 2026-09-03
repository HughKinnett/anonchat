import { pinDelayMs, trustedDeviceStorageKey } from "./e2ee-pin.mjs";

export class TrustedDeviceStateError extends Error {
  constructor(message = "Trusted-device encryption state is corrupt.") {
    super(message);
    this.name = "TrustedDeviceStateError";
  }
}

export const loadTrustedDeviceRecord = (storage, uid) => {
  const raw = storage?.getItem?.(trustedDeviceStorageKey(uid));
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new TrustedDeviceStateError();
  }
};

export const saveTrustedDeviceRecord = (storage, uid, record) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new TrustedDeviceStateError();
  storage.setItem(trustedDeviceStorageKey(uid), JSON.stringify(record));
};

export const removeTrustedDeviceRecord = (storage, uid) => storage.removeItem(trustedDeviceStorageKey(uid));

export const createPinAttemptTracker = ({ now = Date.now } = {}) => {
  const state = new Map();
  const entry = uid => state.get(uid) || { failures: 0, retryAt: 0 };
  return {
    remainingDelay(uid) {
      return Math.max(0, entry(uid).retryAt - Number(now()));
    },
    recordFailure(uid) {
      const current = entry(uid);
      const failures = current.failures + 1;
      const retryAt = Number(now()) + pinDelayMs(failures);
      state.set(uid, { failures, retryAt });
      return Math.max(0, retryAt - Number(now()));
    },
    recordSuccess(uid) {
      state.delete(uid);
    },
    clear(uid) {
      if (uid) state.delete(uid);
      else state.clear();
    }
  };
};
