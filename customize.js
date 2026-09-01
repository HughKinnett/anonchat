import { auth, db } from "./firebase-config.js";
import { hasPremiumAccess, premiumDefaults, PREMIUM_AVATARS, PREMIUM_COVERS } from "./premium-policy.mjs";
import { applyPremiumAvatar, applyPremiumCover } from "./premium-theme.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id), form = $("customize-form"), preview = $("customize-preview"), status = $("customize-status");
let user, settings, selectedAvatar = "none", selectedCover = "none";
const avatarButton = avatarId => {
  const button = document.createElement("button"); button.type = "button"; button.className = "avatar-choice"; button.dataset.avatar = avatarId; button.setAttribute("role", "radio"); button.setAttribute("aria-checked", "false");
  if (avatarId === "none") button.textContent = "Use uploaded photo"; else { const art = document.createElement("span"); applyPremiumAvatar(art, avatarId); const label = avatarId.startsWith("female-") ? avatarId.replace("female-", "Female Avatar ") : avatarId.replace("avatar-", "Avatar "); button.append(art, document.createTextNode(label)); button.setAttribute("aria-label", label); }
  button.onclick = () => { selectedAvatar = avatarId; document.querySelectorAll(".avatar-choice").forEach(entry => entry.setAttribute("aria-checked", String(entry === button))); paint(); };
  return button;
};
$("avatar-choices").append(...PREMIUM_AVATARS.map(avatarButton));
const coverSection = document.createElement("section"), coverTitle = document.createElement("h2"), coverHelp = document.createElement("p"), coverChoices = document.createElement("div"); coverTitle.textContent = "Choose matching cover art"; coverHelp.textContent = "Use your uploaded cover or choose coordinated Premium artwork."; coverHelp.className = "customize-help"; coverChoices.id = "cover-choices"; coverChoices.className = "cover-choice-grid"; coverSection.append(coverTitle, coverHelp, coverChoices); form.querySelector("button[type=submit]").before(coverSection);
PREMIUM_COVERS.forEach(coverId => { const button = document.createElement("button"); button.type = "button"; button.className = "cover-choice"; button.dataset.cover = coverId; button.setAttribute("aria-pressed", "false"); if (coverId === "none") button.textContent = "Use uploaded cover"; else { const art = document.createElement("span"); applyPremiumCover(art, coverId); button.append(art, document.createTextNode(coverId.replace("cover-", "Cover "))); } button.onclick = () => { selectedCover = coverId; document.querySelectorAll(".cover-choice").forEach(entry => entry.setAttribute("aria-pressed", String(entry === button))); paint(); }; coverChoices.append(button); });
const values = () => ({ ...premiumDefaults(user?.uid || ""), onlineVisible: settings?.onlineVisible !== false, profileFrame: $("profile-frame").value, cardStyle: $("card-style").value, bannerStyle: $("banner-style").value, avatarId: selectedAvatar, coverId: selectedCover });
const paint = () => {
  const avatar = $("preview-avatar"); avatar.className = "preview-avatar"; avatar.removeAttribute("style");
  if (!applyPremiumAvatar(avatar, selectedAvatar)) avatar.style.backgroundImage = "url('anonchat-anonymous.png')";
  let cover = preview.querySelector(".preview-premium-cover"); if (!cover) { cover = document.createElement("div"); cover.className = "preview-premium-cover"; preview.prepend(cover); } cover.className = "preview-premium-cover"; cover.removeAttribute("style"); if (!applyPremiumCover(cover, selectedCover)) cover.style.background = values().profileColor;
};
form.addEventListener("input", paint);
form.addEventListener("submit", async event => { event.preventDefault(); if (!user) return; const button = form.querySelector("button[type=submit]"); button.disabled = true; try { settings = { ...settings, ...values(), uid: user.uid, updatedAt: serverTimestamp() }; await setDoc(doc(db, "premiumSettings", user.uid), settings); status.textContent = "Every Premium color and avatar choice is saved."; } catch { status.textContent = "Could not save customization."; } finally { button.disabled = false; } });
onAuthStateChanged(auth, async current => { if (!current) return location.replace("index.html"); const [access, saved] = await Promise.all([getDoc(doc(db, "premiumAccess", current.uid)), getDoc(doc(db, "premiumSettings", current.uid))]); if (!access.exists() || !hasPremiumAccess(access.data())) return location.replace("premium.html"); user = current; settings = { ...premiumDefaults(current.uid), ...(saved.exists() ? saved.data() : {}) }; $("profile-frame").value = settings.profileFrame; $("card-style").value = settings.cardStyle; $("banner-style").value = settings.bannerStyle; selectedAvatar = settings.avatarId || "none"; selectedCover = settings.coverId || "none"; document.querySelector(`[data-avatar="${selectedAvatar}"]`)?.setAttribute("aria-checked", "true"); document.querySelector(`[data-cover="${selectedCover}"]`)?.setAttribute("aria-pressed", "true"); paint(); });
