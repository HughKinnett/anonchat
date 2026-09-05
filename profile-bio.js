import { db } from "./firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const targetUserId = new URLSearchParams(window.location.search).get("uid");
const section = document.getElementById("profile-bio-section");
const bio = document.getElementById("profile-bio");
const profileName = document.getElementById("profile-name");

const hideBio = () => {
  if (bio) bio.textContent = "";
  if (section) section.hidden = true;
};

const profileUnavailable = () => profileName?.textContent === "Unavailable profile";

const renderBio = async () => {
  hideBio();
  if (!targetUserId || !section || !bio) return;
  if (profileUnavailable()) return;
  try {
    const snapshot = await getDoc(doc(db, "users", targetUserId));
    if (!snapshot.exists() || profileUnavailable()) return;
    const value = typeof snapshot.data().bio === "string" ? snapshot.data().bio.trim() : "";
    if (!value || profileUnavailable()) return;
    bio.textContent = value;
    section.hidden = false;
  } catch {
    hideBio();
  }
};

const observer = profileName ? new MutationObserver(() => {
  if (profileUnavailable()) hideBio();
}) : null;
observer?.observe(profileName, { childList: true, characterData: true, subtree: true });

renderBio();
