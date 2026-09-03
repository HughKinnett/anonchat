import { createIdentityBundle, publicKeyFingerprint, unlockIdentityBundle } from "./e2ee-crypto.mjs";
import { doc, getDoc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const identityCache = new Map();
const publicCache = new Map();

const passwordDialog = ({ setup = false } = {}) => new Promise((resolve, reject) => {
  const dialog = document.createElement("dialog");
  dialog.className = "e2ee-password-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const heading = document.createElement("h2");
  heading.textContent = setup ? "Protect your encrypted chats" : "Unlock encrypted chats";
  const explanation = document.createElement("p");
  explanation.textContent = setup
    ? "Create a chat encryption password with at least 12 characters. It never leaves this device, and AnonChat cannot recover it. Use it to unlock messages on another device."
    : "Enter your chat encryption password. It is processed only on this device and is never sent to AnonChat.";
  const password = document.createElement("input");
  password.type = "password";
  password.minLength = 12;
  password.maxLength = 256;
  password.required = true;
  password.autocomplete = setup ? "new-password" : "current-password";
  password.placeholder = "Chat encryption password";
  const confirmation = document.createElement("input");
  confirmation.type = "password";
  confirmation.minLength = 12;
  confirmation.maxLength = 256;
  confirmation.required = setup;
  confirmation.autocomplete = "new-password";
  confirmation.placeholder = "Confirm chat encryption password";
  confirmation.hidden = !setup;
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
  submit.textContent = setup ? "Create encryption keys" : "Unlock";
  actions.append(cancel, submit);
  form.append(heading, explanation, password, confirmation, error, actions);
  dialog.append(form);
  document.body.append(dialog);
  const finish = callback => { dialog.close(); dialog.remove(); callback(); };
  cancel.onclick = () => finish(() => reject(new Error("Encrypted chats remain locked.")));
  dialog.addEventListener("cancel", event => { event.preventDefault(); finish(() => reject(new Error("Encrypted chats remain locked."))); }, { once: true });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (setup && password.value !== confirmation.value) {
      error.textContent = "Those chat encryption passwords do not match.";
      return;
    }
    const value = password.value;
    password.value = "";
    confirmation.value = "";
    finish(() => resolve(value));
  });
  dialog.showModal();
  password.focus();
});

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
    const passphrase = await passwordDialog({ setup: true });
    const created = await createIdentityBundle(passphrase);
    const fingerprint = await publicKeyFingerprint(created.publicJwk);
    const batch = writeBatch(db);
    batch.set(doc(db, "e2eePublicKeys", user.uid), {
      uid: user.uid, version: 1, algorithm: "P-256", publicJwk: created.publicJwk, fingerprint, createdAt: serverTimestamp()
    });
    batch.set(doc(db, "e2eePrivateKeys", user.uid), {
      uid: user.uid, version: 1, privateBundle: created.privateBundle, publicFingerprint: fingerprint,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    await batch.commit();
    const identity = { uid: user.uid, privateKey: created.privateKey, publicJwk: created.publicJwk, fingerprint };
    identityCache.set(user.uid, identity);
    publicCache.set(user.uid, { uid: user.uid, version: 1, algorithm: "P-256", publicJwk: created.publicJwk, fingerprint });
    return identity;
  }

  const passphrase = await passwordDialog();
  const privateKey = await unlockIdentityBundle(privateSnapshot.data().privateBundle, passphrase);
  const publicIdentity = publicSnapshot.data();
  const fingerprint = await publicKeyFingerprint(publicIdentity.publicJwk);
  if (fingerprint !== privateSnapshot.data().publicFingerprint || fingerprint !== publicIdentity.fingerprint) {
    throw new Error("Encrypted-chat key verification failed.");
  }
  const identity = { uid: user.uid, privateKey, publicJwk: publicIdentity.publicJwk, fingerprint };
  identityCache.set(user.uid, identity);
  publicCache.set(user.uid, publicIdentity);
  return identity;
};

export const clearE2eeIdentity = uid => {
  if (uid) identityCache.delete(uid);
  else identityCache.clear();
};
