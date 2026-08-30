import { auth, db } from "./firebase-config.js";
import { chooseDurablePersistence } from "./auth-persistence-policy.mjs";
import { clearFailures, failureState, MAX_CONSECUTIVE_FAILURES, recordInvalidCredential } from "./auth-security-policy.mjs";
import { ensureDefaultOwnerFollows } from "./default-follows.js";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  deleteUser,
  sendEmailVerification,
  sendPasswordResetEmail,
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
let authInProgress = false;

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
    browserSessionPersistence
  ]);

  const normalizedEmail = email.trim().toLowerCase();
  return signInWithEmailAndPassword(auth, normalizedEmail, password);
};

const signInMessage = (error) => {
  if (error.message === "account-banned") return "This account has been banned.";
  if (error.code === "auth/storage-unavailable") {
    return "Your browser is blocking the storage AnonChat needs to keep you signed in. Allow site data for anonchatlogin.web.app, then try again.";
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

const requirePasswordReset = async (email) => {
  await sendPasswordResetEmail(auth, email, {
    url: `${window.location.origin}/index.html?passwordReset=1`,
    handleCodeInApp: false
  });
  setStatus("Three incorrect attempts were detected. A password-reset link was sent to that email. Reset the password before signing in again.", true);
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await exitAfterAuthLoss({ redirect: () => {} });
    return;
  }
  if (authInProgress) return;
  if (!user.emailVerified) {
    await sendEmailVerification(user, { url: `${window.location.origin}/index.html` }).catch(() => {});
    await exitAuthenticatedSession({ user, redirect: () => {} });
    setStatus("Verify your email before signing in. A verification link was sent.", true);
    return;
  }
  const profile = await getDoc(doc(db, "users", user.uid));
  if (profile.exists() && profile.data().banned === true) {
    await exitAuthenticatedSession({ user, redirect: () => {} });
    setStatus("This account has been banned.", true);
    return;
  }
  window.location.replace("timeline.html");
});

document.getElementById("sign-in-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  authInProgress = true;
  setStatus("Signing in…");
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  try {
    const normalizedEmail = email.toLowerCase();
    if (failureState(window.localStorage, normalizedEmail).resetRequired && new URLSearchParams(window.location.search).get("passwordReset") !== "1") {
      await requirePasswordReset(normalizedEmail);
      authInProgress = false;
      return;
    }
    const credential = await signInAcrossDevices(normalizedEmail, password);
    clearFailures(window.localStorage, normalizedEmail);
    if (!credential.user.emailVerified) {
      await sendEmailVerification(credential.user, { url: `${window.location.origin}/index.html` });
      await exitAuthenticatedSession({ user: credential.user, redirect: () => {} });
      throw Object.assign(new Error("email-not-verified"), { code: "auth/email-not-verified" });
    }
    const profile = await getDoc(doc(db, "users", credential.user.uid));
    if (profile.exists() && profile.data().banned === true) {
      await exitAuthenticatedSession({ user: credential.user, redirect: () => {} });
      throw new Error("account-banned");
    }
    window.location.replace("timeline.html");
  } catch (error) {
    authInProgress = false;
    if (error.code === "auth/too-many-requests") {
      clearFailures(window.localStorage, email);
      setStatus("Firebase temporarily paused sign-in attempts for this account or network. AnonChat's local attempt counter has been reset. Wait for Firebase's cooldown, or use Forgot password below now.", true);
      return;
    }
    if (invalidCredentialCodes.includes(error.code)) {
      const attempts = recordInvalidCredential(window.localStorage, email);
      if (attempts.resetRequired) {
        await requirePasswordReset(email.toLowerCase()).catch(() => setStatus("Three incorrect attempts were detected. Use Forgot password below before trying again.", true));
        return;
      }
      setStatus(`That email and password were not recognized. ${MAX_CONSECUTIVE_FAILURES - attempts.count} attempt${MAX_CONSECUTIVE_FAILURES - attempts.count === 1 ? "" : "s"} remain before a password reset is required.`, true);
      return;
    }
    if (error.code === "auth/email-not-verified") {
      setStatus("Verify your email before signing in. A new verification link was sent.", true);
      return;
    }
    setStatus(signInMessage(error), true);
  }
});

const SIGNUPS_OPEN = false;
const signUpForm = document.getElementById("sign-up-form");
signUpForm.hidden = !SIGNUPS_OPEN;
signUpForm.setAttribute("aria-hidden", String(!SIGNUPS_OPEN));

signUpForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!SIGNUPS_OPEN) {
    setStatus("New account registration is temporarily closed.", true);
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
    await sendEmailVerification(newUser, { url: `${window.location.origin}/index.html` });

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
    await exitAuthenticatedSession({ user: newUser, redirect: () => {} });
    setStatus("Account created. Check your email and verify it before signing in.");
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
