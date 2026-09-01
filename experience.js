import { auth } from "./firebase-config.js";
import { contributionSummary, readBookmarks, readExperienceSettings, saveExperienceSettings } from "./experience-preferences.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const form = document.getElementById("experience-form"), status = document.getElementById("experience-status");
const populate = () => { const settings = readExperienceSettings(); Object.keys(settings).forEach(key => { if (form.elements[key]) form.elements[key].checked = settings[key]; }); };
const renderLocal = (uid = "") => {
  const summary = contributionSummary();
  document.getElementById("streak-summary").textContent = `${summary.streak}-day current streak · active on ${summary.totalDays} day${summary.totalDays === 1 ? "" : "s"} from this device.`;
  document.getElementById("streak-badges").replaceChildren(...summary.badges.map(text => { const badge = document.createElement("span"); badge.className = "profile-badge"; badge.textContent = text; return badge; }));
  const host = document.getElementById("local-bookmarks"), bookmarks = readBookmarks();
  host.replaceChildren(...bookmarks.map(item => { const row = document.createElement("li"), link = document.createElement("a"); link.href = `timeline.html#${encodeURIComponent(item.path)}`; link.textContent = `@${item.author}: ${item.excerpt || "Saved post"}`; row.append(link); return row; }));
  if (!bookmarks.length) { const empty = document.createElement("li"); empty.textContent = "No local bookmarks yet."; host.append(empty); }
  document.getElementById("draft-summary").textContent = localStorage.getItem(`anonchat:post-draft:${uid}`) ? "One post draft is safely stored on this device." : "No post draft is stored on this device.";
};
form.addEventListener("submit", event => { event.preventDefault(); saveExperienceSettings(Object.fromEntries(Object.keys(readExperienceSettings()).map(key => [key, form.elements[key]?.checked]))); status.textContent = "Experience saved on this device."; });
document.getElementById("share-anonchat").addEventListener("click", async () => { const data = { title: "AnonChat", text: "Join me on AnonChat.", url: "https://anonchatlogin.web.app/" }; try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); status.textContent = "AnonChat link copied."; } } catch {} });
onAuthStateChanged(auth, user => { if (!user) return location.replace("index.html"); populate(); renderLocal(user.uid); document.getElementById("clear-drafts").onclick = () => { localStorage.removeItem(`anonchat:post-draft:${user.uid}`); renderLocal(user.uid); status.textContent = "Local drafts cleared."; }; });
