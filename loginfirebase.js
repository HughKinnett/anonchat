import { auth, db } from "./firebase-config.js";
import { chooseDurablePersistence } from "./auth-persistence-policy.mjs";
import { ensureDefaultOwnerFollows } from "./default-follows.js";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  setPersistence,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const status = document.getElementById("auth-status");
const signInForm = document.getElementById("sign-in-form");
let authInProgress = false;

signInForm.querySelectorAll("input, button").forEach((control) => {
  control.disabled = false;
});

try {
  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith("anonchat.authFailures.")) window.localStorage.removeItem(key);
  }
} catch { /* Sign-in still works when browser storage is unavailable. */ }

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#ff8080" : "white";
};

if (new URLSearchParams(window.location.search).get("accountDeleted") === "1") {
  setStatus("Your account and AnonChat login were permanently deleted.");
}
if (new URLSearchParams(window.location.search).get("accountDeletionQueued") === "1") {
  setStatus("Your account is locked and permanent deletion is continuing automatically.");
}

const invalidCredentialCodes = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"];

const signInAcrossDevices = async (email, password) => {
  await chooseDurablePersistence(setPersistence, auth, [
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence
  ]);

  const normalizedEmail = email.trim().toLowerCase();
  return signInWithEmailAndPassword(auth, normalizedEmail, password);
};

const signInMessage = (error) => {
  if (error.message === "account-banned") return "This account has been banned.";
  if (error.code === "auth/storage-unavailable") {
    return "Your browser could not initialize authentication storage. Refresh the page and try again.";
  }
  if (error.code === "auth/too-many-requests") {
    return "Too many sign-in attempts. Wait a few minutes or use Forgot password below.";
  }
  if (error.code === "auth/network-request-failed") {
    return "Your computer could not reach the sign-in service. Check its connection, VPN, or browser privacy settings and try again.";
  }
  if (error.code === "auth/user-disabled") return "This account has been disabled.";
  if (invalidCredentialCodes.includes(error.code)) {
    return "That email and password were not recognized. Use Forgot password below to reset it.";
  }
  return "Sign-in failed. Try again or use Forgot password below.";
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await exitAfterAuthLoss({ redirect: () => {} });
    return;
  }
  if (authInProgress) return;
  const profile = await getDoc(doc(db, "users", user.uid));
  if (profile.exists() && profile.data().banned === true) {
    await exitAuthenticatedSession({ user, redirect: () => {} });
    setStatus("This account has been banned.", true);
    return;
  }
  window.location.replace("timeline.html");
});

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authInProgress = true;
  setStatus("Signing in…");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const credential = await signInAcrossDevices(email, password);
    const profile = await getDoc(doc(db, "users", credential.user.uid));
    if (profile.exists() && profile.data().banned === true) {
      await exitAuthenticatedSession({ user: credential.user, redirect: () => {} });
      throw new Error("account-banned");
    }
    window.location.replace("timeline.html");
  } catch (error) {
    authInProgress = false;
    setStatus(signInMessage(error), true);
  }
});

let signupsOpen = false;
const signUpForm = document.getElementById("sign-up-form");
const signupButton = document.getElementById("sign-up");
const registrationSummary = document.getElementById("signup-registration-summary") || signUpForm.closest(".auth-card")?.querySelector("p:not(.signup-closed-notice)");
const signupNotice = document.querySelector(".signup-closed-notice");
const signupControls = [...signUpForm.querySelectorAll("input, button")];
const setSignupAvailability = (enabled) => {
  signupsOpen = enabled === true;
  signUpForm.hidden = false;
  signUpForm.setAttribute("aria-hidden", "false");
  signUpForm.setAttribute("aria-disabled", String(!signupsOpen));
  signUpForm.classList.toggle("signup-locked-form", !signupsOpen);
  signupControls.forEach((control) => { control.disabled = !signupsOpen; });
  signupButton.textContent = signupsOpen ? "Create Account" : "Signups Paused";
  if (registrationSummary) registrationSummary.textContent = signupsOpen ? "New account registration is open." : "New account registration is temporarily closed.";
  if (signupNotice) signupNotice.textContent = signupsOpen ? "Create a new AnonChat account below." : "Existing users can continue signing in normally.";
};
const refreshSignupAvailability = async () => {
  try {
    const snapshot = await getDoc(doc(db, "siteSettings", "features"));
    setSignupAvailability(snapshot.exists() && snapshot.data().registrationsEnabled === true);
    return signupsOpen;
  } catch (error) {
    setSignupAvailability(false);
    setStatus("Could not check whether new registrations are open. Refresh the page and try again.", true);
    return false;
  }
};
setSignupAvailability(false);
void refreshSignupAvailability();

signUpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!(await refreshSignupAvailability())) {
    setStatus("New account registration is temporarily closed by AnonChat administration.", true);
    return;
  }
  const username = document.getElementById("username").value.trim();
  const normalizedUsername = username.toLowerCase();
  const email = document.getElementById("sign-up-email").value.trim().toLowerCase();
  const password = document.getElementById("sign-up-password").value;
  const ageConfirmation = document.getElementById("age-confirmation");
  const termsConfirmation = document.getElementById("terms-confirmation");

  if (!/^[A-Za-z0-9_]{3,30}$/.test(username)) {
    setStatus("Username must be 3–30 letters, numbers, or underscores.", true);
    return;
  }

  if (!ageConfirmation.checked || !termsConfirmation.checked) {
    setStatus("Confirm that you are at least 18 and accept the Terms and Privacy Policy before creating an account.", true);
    return;
  }
  if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    setStatus("Use at least 12 characters with uppercase, lowercase, a number, and a symbol.", true);
    return;
  }

  authInProgress = true;
  setStatus("Creating your account…");
  let newUser;
  try {
    await chooseDurablePersistence(setPersistence, auth, [
      browserLocalPersistence,
      browserSessionPersistence
    ]);
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
        createdAt: serverTimestamp(),
        lastActiveAt: serverTimestamp()
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
    if (error.code === "auth/storage-unavailable") {
      message = "Your browser is blocking the storage AnonChat needs to keep you signed in. Allow site data for anonchatlogin.web.app, then try again.";
    }
    setStatus(message, true);
  }
});

const signInPassword = document.getElementById("password");
const passwordToggle = document.getElementById("toggle-sign-in-password");
passwordToggle?.addEventListener("click", () => {
  const showing = signInPassword.type === "text";
  signInPassword.type = showing ? "password" : "text";
  passwordToggle.textContent = showing ? "Show password" : "Hide password";
  passwordToggle.setAttribute("aria-pressed", String(!showing));
  signInPassword.focus();
});
