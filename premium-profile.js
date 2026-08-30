import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

onAuthStateChanged(auth, async user => {
  const uid = new URLSearchParams(location.search).get("uid") || user?.uid;
  if (!uid) return;
  const snapshot = await getDoc(doc(db, "premiumSettings", uid)).catch(() => null);
  if (snapshot?.exists()) {
    const value = snapshot.data(), colors = { violet: "#8b5cf6", rose: "#ec4899", ocean: "#0ea5e9", emerald: "#10b981" };
    const color = colors[value.accent] || colors.violet, banner = document.querySelector(".view-profile-banner"), avatar = document.getElementById("view-profile-avatar");
    banner?.style.setProperty("--premium-accent", color);
    banner?.classList.add(`premium-banner-${value.bannerStyle || "midnight"}`, `premium-card-${value.cardStyle || "glass"}`);
    if (avatar) { avatar.style.borderColor = color; avatar.style.boxShadow = value.profileFrame === "glow" ? `0 0 28px ${color}` : "none"; avatar.style.borderStyle = value.profileFrame === "double" ? "double" : "solid"; }
  }
});
