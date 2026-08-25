import { auth, db } from "./firebase-config.js";
import { ensureDefaultOwnerFollows } from "./default-follows.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const status = document.getElementById("auth-status");
let authInProgress = false;

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#ff8080" : "white";
};

onAuthStateChanged(auth, async (user) => {
  if (!user || authInProgress) return;
  const profile = await getDoc(doc(db, "users", user.uid));
  if (profile.exists() && profile.data().banned === true) {
    await signOut(auth);
    setStatus("This account has been banned.", true);
    return;
  }
  window.location.replace("timeline.html");
});

document.getElementById("sign-in-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  authInProgress = true;
  setStatus("Signing in…");
  const email = document.getElementById("email").value.trim().toLowerCase();
  const password = document.getElementById("password").value;

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const profile = await getDoc(doc(db, "users", credential.user.uid));
    if (profile.exists() && profile.data().banned === true) {
      await signOut(auth);
      throw new Error("account-banned");
    }
    window.location.replace("timeline.html");
  } catch (error) {
    authInProgress = false;
    setStatus(
      error.message === "account-banned"
        ? "This account has been banned."
        : "Could not sign in. Check your email and password.",
      true
    );
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
      const statsRef = doc(db, "system", "accountStats");
      const usernameSnapshot = await transaction.get(usernameRef);
      const statsSnapshot = await transaction.get(statsRef);
      if (usernameSnapshot.exists()) {
        throw new Error("username-taken");
      }
      if (statsSnapshot.exists() && statsSnapshot.data().count >= 500) {
        throw new Error("site-full");
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
      if (statsSnapshot.exists()) {
        transaction.update(statsRef, {
          count: statsSnapshot.data().count + 1,
          limit: 500,
          updatedAt: serverTimestamp()
        });
      } else {
        transaction.set(statsRef, {
          count: 6,
          limit: 500,
          updatedAt: serverTimestamp()
        });
      }
    });

    await updateProfile(newUser, { displayName: username });
    await ensureDefaultOwnerFollows(newUser.uid, db);
    window.location.replace("timeline.html");
  } catch (error) {
    if (newUser) await deleteUser(newUser).catch(() => {});
    authInProgress = false;
    let message = "Could not create the account. Please check the details and try again.";
    if (error.message === "username-taken") message = "That anonymous username is already taken.";
    if (error.message === "site-full") message = "AnonChat has reached its current 500-user limit.";
    if (error.code === "auth/email-already-in-use") message = "That email address already has an account.";
    setStatus(message, true);
  }
});
