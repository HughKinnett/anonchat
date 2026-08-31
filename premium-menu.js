import { auth, db } from "./firebase-config.js";
import { hasPremiumAccess, premiumDefaults, PREMIUM_COLORS } from "./premium-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const applyAccent = accent => {
  document.body.classList.remove("premium-accent-rose", "premium-accent-ocean", "premium-accent-emerald");
  if (["rose", "ocean", "emerald"].includes(accent)) document.body.classList.add(`premium-accent-${accent}`);
};
const applyPremiumColors = settings => {
  const root = document.documentElement;
  const surfaces = {
    chatBubbleColor: "chat-bubble", timelineFeedColor: "timeline-feed",
    communityBackgroundColor: "community-background", privateBoxColor: "private-box",
    privateChatBubbleColor: "private-chat-bubble", temporaryChatBubbleColor: "temporary-chat-bubble"
  };
  Object.entries(surfaces).forEach(([field, variable]) => {
    const color = PREMIUM_COLORS[settings[field]];
    if (!color) return;
    root.style.setProperty(`--premium-${variable}-bg`, color.background);
    root.style.setProperty(`--premium-${variable}-text`, color.text);
  });
  document.body.classList.add("premium-colors-active");
};

onAuthStateChanged(auth, async user => {
  if (!user) return;
  const menu = document.getElementById("main-menu-panel");
  if (!menu || menu.querySelector(".premium-menu-section")) return;
  const section = document.createElement("section"); section.className = "premium-menu-section";
  const premiumLink = document.createElement("a"); premiumLink.href = "premium.html"; premiumLink.textContent = "Premium · $4.99/month"; section.append(premiumLink);
  const [accessSnap, settingsSnap] = await Promise.all([getDoc(doc(db, "premiumAccess", user.uid)), getDoc(doc(db, "premiumSettings", user.uid))]);
  const access = accessSnap.exists() ? accessSnap.data() : null;
  if (hasPremiumAccess(access)) {
    const customize = document.createElement("a"); customize.href = "customize.html"; customize.textContent = "Customize";
    const rooms = document.createElement("a"); rooms.href = "premium-rooms.html"; rooms.textContent = "Invite-only rooms";
    const settings = { ...premiumDefaults(user.uid), ...(settingsSnap.exists() ? settingsSnap.data() : {}) };
    applyAccent(settings.accent);
    applyPremiumColors(settings);
    const label = document.createElement("label"); label.className = "premium-menu-toggle";
    const text = document.createElement("span"); text.textContent = "Show me online";
    const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.checked = settings.onlineVisible !== false;
    label.append(text, toggle); section.append(customize, rooms, label);
    toggle.onchange = async () => {
      toggle.disabled = true;
      try {
        const next = { ...settings, onlineVisible: toggle.checked, updatedAt: serverTimestamp() };
        await setDoc(doc(db, "premiumSettings", user.uid), next);
        settings.onlineVisible = toggle.checked;
        if (!toggle.checked) await deleteDoc(doc(db, "appPresence", user.uid)).catch(() => {});
        else await setDoc(doc(db, "appPresence", user.uid), { uid: user.uid, openedAt: serverTimestamp() });
      } catch { toggle.checked = !toggle.checked; }
      finally { toggle.disabled = false; }
    };
  }
  const anchor = menu.querySelector(".menu-install") || menu.querySelector(".menu-danger");
  menu.insertBefore(section, anchor || null);
});
