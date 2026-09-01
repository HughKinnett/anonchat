import { auth, db } from "./firebase-config.js";
import { applyFreeAvatar, applyFreeCover, FREE_AVATARS, FREE_COVERS } from "./free-profile-theme.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const avatarHost = document.getElementById("free-avatar-choices"), coverHost = document.getElementById("free-cover-choices"), form = document.getElementById("free-style-form"), status = document.getElementById("free-style-status");
let user, selectedAvatar = "", selectedCover = "";
const select = (kind, value) => {
  if (kind === "avatar") selectedAvatar = value; else selectedCover = value;
  document.querySelectorAll(`[data-free-${kind}]`).forEach(button => button.setAttribute("aria-checked", String(button.dataset[`free${kind[0].toUpperCase()}${kind.slice(1)}`] === value)));
};
FREE_AVATARS.forEach((id, index) => { const button = document.createElement("button"); button.type = "button"; button.className = "avatar-choice"; button.dataset.freeAvatar = id; button.setAttribute("role", "radio"); button.setAttribute("aria-checked", "false"); if (!id) button.textContent = "Use uploaded photo"; else { const art = document.createElement("span"); applyFreeAvatar(art, id); button.append(art, document.createTextNode(index <= 4 ? `Avatar ${index}` : `Female avatar ${index - 4}`)); } button.onclick = () => select("avatar", id); avatarHost.append(button); });
FREE_COVERS.forEach((id, index) => { const button = document.createElement("button"); button.type = "button"; button.className = "cover-choice"; button.dataset.freeCover = id; button.setAttribute("role", "radio"); button.setAttribute("aria-checked", "false"); if (!id) button.textContent = "Use uploaded cover"; else { const art = document.createElement("span"); applyFreeCover(art, id); button.append(art, document.createTextNode(`Cover ${index}`)); } button.onclick = () => select("cover", id); coverHost.append(button); });
form.addEventListener("submit", async event => { event.preventDefault(); if (!user) return; const button = form.querySelector("button[type=submit]"); button.disabled = true; try { await setDoc(doc(db, "users", user.uid), { freeAvatarId: selectedAvatar, freeCoverId: selectedCover }, { merge: true }); status.textContent = "Profile appearance saved."; } catch { status.textContent = "Could not save profile appearance."; } finally { button.disabled = false; } });
onAuthStateChanged(auth, async current => { if (!current) return location.replace("index.html"); user = current; const snapshot = await getDoc(doc(db, "users", current.uid)); const data = snapshot.exists() ? snapshot.data() : {}; selectedAvatar = FREE_AVATARS.includes(data.freeAvatarId) ? data.freeAvatarId : ""; selectedCover = FREE_COVERS.includes(data.freeCoverId) ? data.freeCoverId : ""; select("avatar", selectedAvatar); select("cover", selectedCover); });
