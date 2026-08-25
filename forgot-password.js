import { auth } from "./firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const form = document.getElementById("password-reset-form");
const status = document.getElementById("reset-status");

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#ff8080" : "white";
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("reset-email").value.trim().toLowerCase();
  const confirmation = document.getElementById("confirm-reset-email").value.trim().toLowerCase();
  if (email !== confirmation) {
    setStatus("The email addresses do not match.", true);
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  setStatus("Sending your secure reset link…");
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus("Reset link sent. Check your inbox and spam folder, then use the link to choose a new password.");
    form.reset();
  } catch (error) {
    if (error.code === "auth/invalid-email") setStatus("Enter a valid email address.", true);
    else if (error.code === "auth/too-many-requests") setStatus("Too many attempts. Wait a few minutes and try again.", true);
    else setStatus("Could not send the reset link. Check your connection and try again.", true);
  } finally {
    submit.disabled = false;
  }
});
