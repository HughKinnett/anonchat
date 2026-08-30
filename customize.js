import { auth, db } from "./firebase-config.js";
import { hasPremiumAccess, premiumDefaults } from "./premium-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const ids = { accent: "accent", profileFrame: "profile-frame", cardStyle: "card-style", bannerStyle: "banner-style" };
const form = document.getElementById("customize-form"), preview = document.getElementById("customize-preview"), status = document.getElementById("customize-status");
let user = null, settings = null;
const values = () => Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, document.getElementById(id).value]));
const paint = () => {
  const value = values(), colors = { violet: "#8b5cf6", rose: "#ec4899", ocean: "#0ea5e9", emerald: "#10b981" };
  preview.style.setProperty("--preview-accent", colors[value.accent]);
  preview.dataset.frame = value.profileFrame; preview.dataset.card = value.cardStyle; preview.dataset.banner = value.bannerStyle;
  const banner = preview.querySelector(".preview-banner");
  banner.style.background = value.bannerStyle === "aurora" ? "linear-gradient(135deg,#143642,#5b21b6,#db2777)" : value.bannerStyle === "ember" ? "linear-gradient(135deg,#27130f,#b45309,#7f1d1d)" : "linear-gradient(135deg,#111827,#4c1d95)";
  const card = preview.querySelector(".preview-card"); card.style.background = value.cardStyle === "solid" ? "#202330" : value.cardStyle === "outline" ? "transparent" : "rgba(255,255,255,.07)";
  const avatar = preview.querySelector(".preview-avatar"); avatar.style.boxShadow = value.profileFrame === "glow" ? `0 0 26px ${colors[value.accent]}` : "none"; avatar.style.borderStyle = value.profileFrame === "double" ? "double" : "solid";
};
form.addEventListener("input", paint);
form.addEventListener("submit", async event => { event.preventDefault(); if (!user) return; const button=form.querySelector("button"); button.disabled=true; try { settings={...settings,...values(),uid:user.uid,updatedAt:serverTimestamp()}; await setDoc(doc(db,"premiumSettings",user.uid),settings); status.textContent="Your Premium style is saved."; } catch { status.textContent="Could not save customization."; } finally { button.disabled=false; } });
onAuthStateChanged(auth, async current => {
  if (!current) { location.replace("index.html"); return; }
  const [access, saved] = await Promise.all([getDoc(doc(db,"premiumAccess",current.uid)),getDoc(doc(db,"premiumSettings",current.uid))]);
  if (!access.exists() || !hasPremiumAccess(access.data())) { location.replace("premium.html"); return; }
  user=current; settings={...premiumDefaults(current.uid),...(saved.exists()?saved.data():{})};
  Object.entries(ids).forEach(([key,id])=>{document.getElementById(id).value=settings[key];}); paint();
});
