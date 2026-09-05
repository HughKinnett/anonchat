import { auth, db } from "./firebase-config.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const DEFAULTS = Object.freeze({ badgesEnabled: true, editingEnabled: true, galleriesEnabled: true, discoveryEnabled: true, groupChatsEnabled: true, notificationControlsEnabled: true });
const apply = (flags) => {
  const resolved = { ...DEFAULTS, ...flags }; window.anonchatUxFlags = resolved;
  document.documentElement.dataset.uxBadges = resolved.badgesEnabled ? "on" : "off";
  document.documentElement.dataset.uxEditing = resolved.editingEnabled ? "on" : "off";
  document.documentElement.dataset.uxGalleries = resolved.galleriesEnabled ? "on" : "off";
  document.documentElement.dataset.uxDiscovery = resolved.discoveryEnabled ? "on" : "off";
  document.documentElement.dataset.uxGroups = resolved.groupChatsEnabled ? "on" : "off";
  document.documentElement.dataset.uxNotifications = resolved.notificationControlsEnabled ? "on" : "off";
  document.querySelectorAll('[data-requires-ux-feature]').forEach((element) => {
    const key = element.dataset.requiresUxFeature; element.hidden = resolved[key] === false;
  });
  if (location.pathname.endsWith("/discover.html") && resolved.discoveryEnabled === false) {
    const status = document.getElementById("discover-status"); if (status) status.textContent = "Discover is temporarily paused by an administrator.";
    document.querySelectorAll("#trending-posts,#popular-today,#topic-list,#suggested-people,#discover-results").forEach((element) => element.replaceChildren());
  }
  window.dispatchEvent(new CustomEvent("anonchat:ux-flags", { detail: resolved }));
};
apply(DEFAULTS);
onAuthStateChanged(auth, (user) => {
  if (!user) return;
  onSnapshot(doc(db, "siteSettings", "userExperience"), (snapshot) => apply(snapshot.exists() ? snapshot.data() : DEFAULTS), () => apply(DEFAULTS));
});
