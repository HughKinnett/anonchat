import { auth, db } from "./firebase-config.js";
import { hasPremiumAccess, premiumDefaults } from "./premium-policy.mjs";
import { applyPremiumTheme } from "./premium-theme.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

onAuthStateChanged(auth, async user => {
  if (!user) return;
  const menu = document.getElementById("main-menu-panel");
  if (!menu || menu.querySelector(".premium-menu-section")) return;
  const section = document.createElement("section"); section.className = "premium-menu-section";
  const appearanceLink = document.createElement("a"); appearanceLink.href = "profile-style.html"; appearanceLink.textContent = "Profile appearance"; section.append(appearanceLink);
  const premiumLink = document.createElement("a"); premiumLink.href = "premium.html"; premiumLink.textContent = "Premium · $4.99/month"; section.append(premiumLink);
  const shareLink = async (title, text, url) => {
    try { if (navigator.share) await navigator.share({ title, text, url }); else { await navigator.clipboard.writeText(url); window.alert("Link copied."); } } catch { /* The user can cancel the share sheet. */ }
  };
  const invite = document.createElement("button"); invite.type = "button"; invite.textContent = "Invite friends"; invite.onclick = () => shareLink("AnonChat", "Join me on AnonChat.", "https://anonchatlogin.web.app/");
  const shareProfile = document.createElement("button"); shareProfile.type = "button"; shareProfile.textContent = "Share my profile"; shareProfile.onclick = () => shareLink("My AnonChat profile", "Find my anonymous profile on AnonChat.", `https://anonchatlogin.web.app/profile.html?uid=${encodeURIComponent(user.uid)}`);
  section.append(invite, shareProfile);
  const [accessSnap, settingsSnap] = await Promise.all([getDoc(doc(db, "premiumAccess", user.uid)), getDoc(doc(db, "premiumSettings", user.uid))]);
  const access = accessSnap.exists() ? accessSnap.data() : null;
  if (hasPremiumAccess(access)) {
    const customize = document.createElement("a"); customize.href = "customize.html"; customize.textContent = "Customize";
    const rooms = document.createElement("a"); rooms.href = "premium-rooms.html"; rooms.textContent = "Invite-only rooms";
    const settings = { ...premiumDefaults(user.uid), ...(settingsSnap.exists() ? settingsSnap.data() : {}) };
    applyPremiumTheme(document.body, settings);
    const label = document.createElement("label"); label.className = "premium-menu-toggle";
    const text = document.createElement("span");
    const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = settings.onlineVisible === false;
    const updateGhostLabel = () => { text.textContent = `Ghost Mode: ${toggle.checked ? "On" : "Off"}`; }; updateGhostLabel();
    label.append(text, toggle); section.append(customize, rooms, label);
    toggle.onchange = async () => {
      toggle.disabled = true;
      try {
        const next = { ...settings, onlineVisible: !toggle.checked, updatedAt: serverTimestamp() };
        await setDoc(doc(db, "premiumSettings", user.uid), next);
        settings.onlineVisible = !toggle.checked; updateGhostLabel();
        if (toggle.checked) await deleteDoc(doc(db, "appPresence", user.uid)).catch(() => {});
        else await setDoc(doc(db, "appPresence", user.uid), { uid: user.uid, openedAt: serverTimestamp() });
      } catch { toggle.checked = !toggle.checked; updateGhostLabel(); }
      finally { toggle.disabled = false; }
    };
  }
  const anchor = menu.querySelector(".menu-install") || menu.querySelector(".menu-danger");
  menu.insertBefore(section, anchor || null);
});
