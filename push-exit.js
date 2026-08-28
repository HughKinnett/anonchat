import { auth, db } from "./firebase-config.js";
import { createPushAlertsClient } from "./push-client.mjs";
import { VAPID_PUBLIC_KEY } from "./push-config.mjs";
import { createPushExitCoordinator } from "./push-session.mjs";
import { signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { deleteDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const serviceWorkerSupported = "serviceWorker" in navigator;
const cleanupClient = createPushAlertsClient({
  notification: "Notification" in window ? window.Notification : null,
  serviceWorkerSupported,
  pushSupported: "PushManager" in window,
  serviceWorkerReady: serviceWorkerSupported ? navigator.serviceWorker.ready : null,
  publicKey: VAPID_PUBLIC_KEY,
  subtle: window.crypto?.subtle,
  timestamp: serverTimestamp,
  persist: async () => {},
  remove: ({ id }) => deleteDoc(doc(db, "pushSubscriptions", id)),
  logger: null
});

const exits = createPushExitCoordinator({
  cleanupAuthenticated: (user) => cleanupClient.cleanupForSignOut(user),
  cleanupUnauthenticated: (options) => cleanupClient.cleanupForSignOut(null, options),
  signOut: () => firebaseSignOut(auth)
});

export const exitAuthenticatedSession = (options) => exits.authenticated(options);
export const exitAfterAuthLoss = (options) => exits.authLoss(options);
