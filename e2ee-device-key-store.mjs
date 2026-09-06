const DB_NAME = "anonchat-e2ee-device-trust";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const RECORD_STORE = "records";
const KEY_ID = "device-wrap-key-v1";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class AutoUnlockStateError extends Error {
  constructor(message = "Trusted-device auto-unlock state is unavailable.") {
    super(message);
    this.name = "AutoUnlockStateError";
  }
}

const requestResult = request => new Promise((resolve, reject) => {
  request.addEventListener("success", () => resolve(request.result), { once: true });
  request.addEventListener("error", () => reject(request.error || new AutoUnlockStateError()), { once: true });
});

const transactionDone = transaction => new Promise((resolve, reject) => {
  transaction.addEventListener("complete", resolve, { once: true });
  transaction.addEventListener("abort", () => reject(transaction.error || new AutoUnlockStateError()), { once: true });
  transaction.addEventListener("error", () => reject(transaction.error || new AutoUnlockStateError()), { once: true });
});

const openDb = async () => {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) throw new AutoUnlockStateError();
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.addEventListener("upgradeneeded", () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    if (!db.objectStoreNames.contains(RECORD_STORE)) db.createObjectStore(RECORD_STORE);
  }, { once: true });
  return requestResult(request);
};

const getOrCreateDeviceKey = async db => {
  const readTx = db.transaction(KEY_STORE, "readonly");
  const existing = await requestResult(readTx.objectStore(KEY_STORE).get(KEY_ID));
  await transactionDone(readTx);
  if (existing instanceof CryptoKey) return existing;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const writeTx = db.transaction(KEY_STORE, "readwrite");
  writeTx.objectStore(KEY_STORE).put(key, KEY_ID);
  await transactionDone(writeTx);
  return key;
};

const bytesToBase64 = bytes => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = value => {
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};

export const saveAutoUnlockIdentity = async (uid, privateJwk) => {
  if (!uid || !privateJwk || typeof privateJwk !== "object") throw new AutoUnlockStateError();
  const db = await openDb();
  try {
    const key = await getOrCreateDeviceKey(db);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(JSON.stringify(privateJwk));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
    const tx = db.transaction(RECORD_STORE, "readwrite");
    tx.objectStore(RECORD_STORE).put({
      version: 1,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      updatedAt: Date.now()
    }, String(uid));
    await transactionDone(tx);
  } catch (error) {
    throw error instanceof AutoUnlockStateError ? error : new AutoUnlockStateError();
  } finally {
    db.close();
  }
};

export const loadAutoUnlockIdentity = async uid => {
  if (!uid) return null;
  const db = await openDb();
  try {
    const key = await getOrCreateDeviceKey(db);
    const tx = db.transaction(RECORD_STORE, "readonly");
    const record = await requestResult(tx.objectStore(RECORD_STORE).get(String(uid)));
    await transactionDone(tx);
    if (!record) return null;
    if (record.version !== 1 || !record.iv || !record.ciphertext) throw new AutoUnlockStateError();
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(record.iv) },
      key,
      base64ToBytes(record.ciphertext)
    );
    const parsed = JSON.parse(decoder.decode(plaintext));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.d) throw new AutoUnlockStateError();
    return parsed;
  } catch (error) {
    if (error instanceof AutoUnlockStateError) throw error;
    throw new AutoUnlockStateError();
  } finally {
    db.close();
  }
};

export const removeAutoUnlockIdentity = async uid => {
  if (!uid) return;
  const db = await openDb();
  try {
    const tx = db.transaction(RECORD_STORE, "readwrite");
    tx.objectStore(RECORD_STORE).delete(String(uid));
    await transactionDone(tx);
  } finally {
    db.close();
  }
};
