import { auth, db } from "./firebase-config.js";
import { hasPremiumAccess } from "./premium-policy.mjs";
import { applyPremiumAvatar, applyPremiumCover, applyPremiumTheme, resolvedPremiumSettings } from "./premium-theme.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

onAuthStateChanged(auth, async user => {
  const uid = new URLSearchParams(location.search).get("uid") || user?.uid; if (!uid) return;
  const [snapshot, access] = await Promise.all([getDoc(doc(db, "premiumSettings", uid)), getDoc(doc(db, "premiumAccess", uid))]).catch(() => []); if (!snapshot?.exists() || !access?.exists() || !hasPremiumAccess(access.data())) return;
  const settings = resolvedPremiumSettings(uid, snapshot.data()); applyPremiumTheme(document.body, settings);
  const avatar = document.getElementById("view-profile-avatar"); if (avatar) setTimeout(() => applyPremiumAvatar(avatar, settings.avatarId), 0);
  const cover = document.getElementById("view-profile-cover"); if (cover) setTimeout(() => applyPremiumCover(cover, settings.coverId), 0);
});
