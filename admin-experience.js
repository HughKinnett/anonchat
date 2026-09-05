import { auth, db } from "./firebase-config.js";
import { isDesignatedAdmin } from "./designated-admin-policy.mjs";
import { BADGE_CATALOG, normalizeBadgeDefinition } from "./badge-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, collectionGroup, doc, getCountFromServer, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let admin = null;
let definitions = [...BADGE_CATALOG];
const DEFAULT_FLAGS = Object.freeze({ badgesEnabled: true, editingEnabled: true, galleriesEnabled: true, discoveryEnabled: true, groupChatsEnabled: true, notificationControlsEnabled: true });
const toast = (text) => { const node = document.createElement("div"); node.className = "ux-toast"; node.textContent = text; document.body.append(node); setTimeout(() => node.remove(), 1800); };

const verifyAdmin = async (user) => {
  if (!user) return false;
  const profile = await getDoc(doc(db, "users", user.uid));
  return profile.exists() && isDesignatedAdmin(profile.data().username);
};

const renderBadgeCatalog = () => {
  const host = $("admin-badge-catalog"); const select = $("award-badge-id"); if (!host || !select) return;
  host.replaceChildren(...definitions.map((badge) => { const row = document.createElement("div"); row.className = "admin-badge-preview"; const image = document.createElement("img"); image.src = badge.image; image.alt = `${badge.name} badge`; const copy = document.createElement("div"); const name = document.createElement("strong"); name.textContent = badge.name; const desc = document.createElement("small"); desc.textContent = badge.description; copy.append(name, document.createElement("br"), desc); row.append(image, copy); return row; }));
  select.replaceChildren(...definitions.map((badge) => new Option(badge.name, badge.id)));
};

const loadDefinitions = async () => {
  try {
    const snapshot = await getDocs(query(collection(db, "badgeDefinitions"), limit(50)));
    const custom = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    const map = new Map(BADGE_CATALOG.map((badge) => [badge.id, badge])); custom.forEach((badge) => map.set(badge.id, badge)); definitions = [...map.values()];
  } catch { definitions = [...BADGE_CATALOG]; }
  renderBadgeCatalog();
};

const saveCustomBadge = async (event) => {
  event.preventDefault();
  const badge = normalizeBadgeDefinition({ id: $("custom-badge-id")?.value, name: $("custom-badge-name")?.value, description: $("custom-badge-description")?.value, image: $("custom-badge-image")?.value, active: true });
  if (!badge.id || !badge.name || !badge.description || !/^badge-[A-Za-z0-9_-]+\.svg$/.test(badge.image)) { toast("Use a badge ID, name, description, and an approved local badge SVG filename."); return; }
  await setDoc(doc(db, "badgeDefinitions", badge.id), { ...badge, updatedBy: admin.uid, updatedAt: serverTimestamp() }); event.target.reset(); await loadDefinitions(); toast("Badge definition saved.");
};

const awardBadge = async (event) => {
  event.preventDefault(); const userId = $("award-user-id")?.value.trim(); const badgeId = $("award-badge-id")?.value; const note = $("award-badge-note")?.value.trim().slice(0, 140);
  if (!userId || !badgeId) return;
  const target = await getDoc(doc(db, "users", userId)); if (!target.exists()) { toast("No user exists with that Firebase UID."); return; }
  await setDoc(doc(db, "userBadges", userId, "awards", badgeId), { userId, badgeId, note, awardedBy: admin.uid, awardedAt: serverTimestamp() }); toast("Badge awarded.");
};
const revokeBadge = async () => { const userId = $("award-user-id")?.value.trim(); const badgeId = $("award-badge-id")?.value; if (!userId || !badgeId) return; await deleteDoc(doc(db, "userBadges", userId, "awards", badgeId)); toast("Badge removed."); };

const renderFlags = (flags = DEFAULT_FLAGS) => {
  document.querySelectorAll("[data-ux-feature]").forEach((input) => { input.checked = flags[input.dataset.uxFeature] !== false; });
};
const saveFlags = async (event) => {
  event.preventDefault(); const flags = { ...DEFAULT_FLAGS }; document.querySelectorAll("[data-ux-feature]").forEach((input) => { flags[input.dataset.uxFeature] = input.checked; });
  await setDoc(doc(db, "siteSettings", "userExperience"), { ...flags, updatedBy: admin.uid, updatedAt: serverTimestamp() }); toast("User-experience controls saved.");
};

const renderCounts = async () => {
  const host = $("user-experience-summary"); if (!host) return; const rows = [];
  const count = async (label, reference) => { try { const result = await getCountFromServer(reference); rows.push(`${label}: ${result.data().count}`); } catch { rows.push(`${label}: not checked here`); } };
  await count("Private groups", collection(db, "groupChats")); await count("Comment replies", collection(db, "commentReplies")); await count("Post galleries", collection(db, "postMedia")); await count("Content edits", collection(db, "contentEdits"));
  try { const badgeCount = await getCountFromServer(collectionGroup(db, "awards")); rows.push(`Badges awarded: ${badgeCount.data().count}`); } catch { rows.push("Badges awarded: not checked here"); }
  host.replaceChildren(...rows.map((text) => { const item = document.createElement("div"); item.className = "attention-card"; item.textContent = text; return item; }));
};

onAuthStateChanged(auth, async (user) => {
  if (!await verifyAdmin(user)) return; admin = user;
  void loadDefinitions(); void renderCounts();
  onSnapshot(doc(db, "siteSettings", "userExperience"), (snapshot) => renderFlags(snapshot.exists() ? { ...DEFAULT_FLAGS, ...snapshot.data() } : DEFAULT_FLAGS), () => renderFlags(DEFAULT_FLAGS));
});
$("custom-badge-form")?.addEventListener("submit", (event) => void saveCustomBadge(event).catch(() => toast("Could not save badge definition.")));
$("award-badge-form")?.addEventListener("submit", (event) => void awardBadge(event).catch(() => toast("Could not award badge.")));
$("revoke-badge")?.addEventListener("click", () => void revokeBadge().catch(() => toast("Could not remove badge.")));
$("user-experience-controls")?.addEventListener("submit", (event) => void saveFlags(event).catch(() => toast("Could not save feature controls.")));
$("refresh-user-experience-summary")?.addEventListener("click", () => void renderCounts());
