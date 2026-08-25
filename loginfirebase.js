import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const status = document.getElementById("auth-status");
let authInProgress = false;

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#ff8080" : "white";
};

onAuthStateChanged(auth, (user) => {
  if (user && !authInProgress) window.location.replace("timeline.html");
});

document.getElementById("sign-in-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  authInProgress = true;
  setStatus("Signing in…");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.replace("timeline.html");
  } catch {
    authInProgress = false;
    setStatus("Could not sign in. Check your email and password.", true);
  }
});

document.getElementById("sign-up-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = document.getElementById("username").value.trim();
  const normalizedUsername = username.toLowerCase();
  const email = document.getElementById("sign-up-email").value.trim();
  const password = document.getElementById("sign-up-password").value;

  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    setStatus("Username must be 3–30 letters, numbers, or underscores.", true);
    return;
  }

  authInProgress = true;
  setStatus("Creating your anonymous account…");
  let newUser;
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    newUser = credential.user;

    await runTransaction(db, async (transaction) => {
      const usernameRef = doc(db, "usernames", normalizedUsername);
      if ((await transaction.get(usernameRef)).exists()) {
        throw new Error("username-taken");
      }

      transaction.set(usernameRef, {
        uid: newUser.uid,
        username,
        createdAt: serverTimestamp()
      });
      transaction.set(doc(db, "users", newUser.uid), {
        uid: newUser.uid,
        username,
        createdAt: serverTimestamp()
      });
    });

    await updateProfile(newUser, { displayName: username });
    window.location.replace("timeline.html");
  } catch (error) {
    if (newUser) await deleteUser(newUser).catch(() => {});
    authInProgress = false;
    let message = "Could not create the account. Please check the details and try again.";
    if (error.message === "username-taken") message = "That anonymous username is already taken.";
    if (error.code === "auth/email-already-in-use") message = "That email address already has an account.";
    setStatus(message, true);
  }
});
