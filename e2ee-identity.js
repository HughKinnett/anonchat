import {
  createIdentityBundle,
  importPrivateKeyJwk,
  publicKeyFingerprint,
  unlockIdentityBundleJwk
} from "./e2ee-crypto.mjs";
import { createTrustedDeviceRecord, unlockTrustedDeviceRecord, validateChatPin } from "./e2ee-pin.mjs";
import {
  TrustedDeviceStateError,
  createPinAttemptTracker,
  loadTrustedDeviceRecord,
  saveTrustedDeviceRecord
} from "./e2ee-device-store.mjs";
import { doc, getDoc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const identityCache = new Map();
const publicCache = new Map();
const pinAttempts = createPinAttemptTracker();

const storage = () => {
  if (!globalThis.localStorage) throw new Error("Trusted-device storage is unavailable. Use encryption recovery on this device.");
  return globalThis.localStorage;
};

const secureDialog = ({
  headingText,
  explanationText,
  placeholder,
  confirmationPlaceholder,
  setup = false,
  pin = false,
  submitText = "Continue"
}) => new Promise((resolve, reject) => {
  const dialog = document.createElement("dialog");
  dialog.className = "e2ee-password-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const heading = document.createElement("h2");
  heading.textContent = headingText;
  const explanation = document.createElement("p");
  explanation.textContent = explanationText;
  const input = document.createElement("input");
  input.type = "password";
  input.required = true;
  input.autocomplete = setup ? "new-password" : "current-password";
  input.placeholder = placeholder;
  if (pin) {
    input.inputMode = "numeric";
    input.pattern = "[0-9]{4}";
    input.minLength = 4;
    input.maxLength = 4;
  } else {
    input.minLength = 12;
    input.maxLength = 256;
  }
  const confirmation = document.createElement("input");
  confirmation.type = "password";
  confirmation.required = setup;
  confirmation.autocomplete = "new-password";
  confirmation.placeholder = confirmationPlaceholder || placeholder;
  confirmation.hidden = !setup;
  if (pin) {
    confirmation.inputMode = "numeric";
    confirmation.pattern = "[0-9]{4}";
    confirmation.minLength = 4;
    confirmation.maxLength = 4;
  } else {
    confirmation.minLength = 12;
    confirmation.maxLength = 256;
  }
  const error = document.createElement("p");
  error.className = "e2ee-password-error";
  error.setAttribute("role", "alert");
  const actions = document.createElement("div");
  actions.className = "e2ee-password-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = submitText;
  actions.append(cancel, submit);
  form.append(heading, explanation, input, confirmation, error, actions);
  dialog.append(form);
  document.body.append(dialog);
  const finish = callback => { dialog.close(); dialog.remove(); callback(); };
  cancel.onclick = () => finish(() => reject(new Error("Encrypted chats remain locked.")));
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    finish(() => reject(new Error("Encrypted chats remain locked.")));
  }, { once: true });
  form.addEventListener("submit", event => {
    event.preventDefault();
    const value = input.value;
    if (pin) {
      try { validateChatPin(value); } catch (dialogError) { error.textContent = dialogError.message; return; }
    }
    if (setup && value !== confirmation.value) {
      error.textContent = pin ? "Those chat PINs do not match." : "Those chat encryption passwords do not match.";
      return;
    }
    input.value = "";
    confirmation.value = "";
    finish(() => resolve(value));
  });
  dialog.showModal();
  input.focus();
});

const chatPinDialog = ({ setup = false } = {}) => secureDialog({
  setup,
  pin: true,
  headingText: setup ? "Create chat PIN" : "Enter chat PIN",
  explanationText: setup
    ? "Choose exactly four digits for quick encrypted-chat unlocks on this trusted device."
    : "Enter your four-digit chat PIN to unlock encrypted chats on this device.",
  placeholder: setup ? "Create chat PIN" : "Enter chat PIN",
  confirmationPlaceholder: "Confirm chat PIN",
  submitText: setup ? "Save PIN" : "Unlock"
});

const recoveryPassphraseDialog = ({ setup = false } = {}) => secureDialog({
  setup,
  pin: false,
  headingText: setup ? "Create encryption recovery password" : "Recover encrypted chats",
  explanationText: setup
    ? "Create a recovery password with at least 12 characters. You normally use your four-digit PIN; this stronger password is only for a new or reset device."
    : "This device is not trusted yet. Enter your existing chat encryption recovery password once, then you can create a four-digit PIN for this device.",
  placeholder: "Encryption recovery password",
  confirmationPlaceholder: "Confirm recovery password",
  submitText: setup ? "Create recovery password" : "Recover"
});

const persistVerifiedPinRecord = async (uid, privateJwk, pin) => {
  const record = await createTrustedDeviceRecord(privateJwk, pin);
  const verified = await unlockTrustedDeviceRecord(record, pin);
  if (verified.d !== privateJwk.d || verified.x !== privateJwk.x || verified.y !== privateJwk.y) {
    throw new Error("Chat PIN verification failed. Your previous encryption recovery remains unchanged.");
  }
  saveTrustedDeviceRecord(storage(), uid, record);
};

const unlockTrustedIdentity = async (uid, record) => {
  const remaining = pinAttempts.remainingDelay(uid);
  if (remaining > 0) throw new Error(`Too many incorrect PIN attempts. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
  const pin = await chatPinDialog();
  try {
    const privateJwk = await unlockTrustedDeviceRecord(record, pin);
    pinAttempts.recordSuccess(uid);
    return { privateJwk, privateKey: await importPrivateKeyJwk(privateJwk) };
  } catch (error) {
    const delay = pinAttempts.recordFailure(uid);
    throw new Error(`That chat PIN is incorrect. Try again in ${Math.ceil(delay / 1000)} seconds.`);
  }
};

export const getE2eePublicIdentity = async (db, uid) => {
  if (publicCache.has(uid)) return publicCache.get(uid);
  const snapshot = await getDoc(doc(db, "e2eePublicKeys", uid));
  if (!snapshot.exists()) return null;
  const value = snapshot.data();
  publicCache.set(uid, value);
  return value;
};

export const ensureE2eeIdentity = async (db, user) => {
  if (identityCache.has(user.uid)) return identityCache.get(user.uid);
  const [publicSnapshot, privateSnapshot] = await Promise.all([
    getDoc(doc(db, "e2eePublicKeys", user.uid)),
    getDoc(doc(db, "e2eePrivateKeys", user.uid))
  ]);
  if (publicSnapshot.exists() !== privateSnapshot.exists()) throw new Error("Your encrypted-chat identity is incomplete. Contact AnonChat support.");

  if (!privateSnapshot.exists()) {
    const recoveryPassphrase = await recoveryPassphraseDialog({ setup: true });
    const created = await createIdentityBundle(recoveryPassphrase);
    const pin = await chatPinDialog({ setup: true });
    await persistVerifiedPinRecord(user.uid, created.privateJwk, pin);
    const fingerprint = await publicKeyFingerprint(created.publicJwk);
    const batch = writeBatch(db);
    batch.set(doc(db, "e2eePublicKeys", user.uid), {
      uid: user.uid, version: 1, algorithm: "P-256", publicJwk: created.publicJwk, fingerprint, createdAt: serverTimestamp()
    });
    batch.set(doc(db, "e2eePrivateKeys", user.uid), {
      uid: user.uid, version: 1, privateBundle: created.privateBundle, publicFingerprint: fingerprint,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    try {
      await batch.commit();
    } catch (error) {
      throw new Error(`Encrypted-chat setup could not be saved. ${error?.message || "Try again."}`);
    }
    const identity = { uid: user.uid, privateKey: created.privateKey, publicJwk: created.publicJwk, fingerprint };
    identityCache.set(user.uid, identity);
    publicCache.set(user.uid, { uid: user.uid, version: 1, algorithm: "P-256", publicJwk: created.publicJwk, fingerprint });
    return identity;
  }

  const publicIdentity = publicSnapshot.data();
  const fingerprint = await publicKeyFingerprint(publicIdentity.publicJwk);
  if (fingerprint !== privateSnapshot.data().publicFingerprint || fingerprint !== publicIdentity.fingerprint) {
    throw new Error("Encrypted-chat key verification failed.");
  }

  let record;
  try {
    record = loadTrustedDeviceRecord(storage(), user.uid);
  } catch (error) {
    if (!(error instanceof TrustedDeviceStateError)) throw error;
    record = null;
  }

  let privateKey;
  if (record) {
    ({ privateKey } = await unlockTrustedIdentity(user.uid, record));
  } else {
    const recoveryPassphrase = await recoveryPassphraseDialog();
    const privateJwk = await unlockIdentityBundleJwk(privateSnapshot.data().privateBundle, recoveryPassphrase);
    const pin = await chatPinDialog({ setup: true });
    await persistVerifiedPinRecord(user.uid, privateJwk, pin);
    privateKey = await importPrivateKeyJwk(privateJwk);
  }

  const identity = { uid: user.uid, privateKey, publicJwk: publicIdentity.publicJwk, fingerprint };
  identityCache.set(user.uid, identity);
  publicCache.set(user.uid, publicIdentity);
  return identity;
};

export const clearE2eeSession = uid => {
  if (uid) identityCache.delete(uid);
  else identityCache.clear();
  pinAttempts.clear(uid);
};

export const clearE2eeIdentity = uid => clearE2eeSession(uid);
