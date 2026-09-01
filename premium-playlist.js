import { auth, db } from "./firebase-config.js";
import { hasPremiumAccess, premiumDefaults } from "./premium-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const form = document.getElementById("playlist-form"), input = document.getElementById("playlist-url"), remove = document.getElementById("playlist-remove"), status = document.getElementById("playlist-status"), player = document.getElementById("playlist-player");
let currentUser, settings;
const playlistId = (value) => {
  try { const url = new URL(String(value || "").trim()); if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return ""; return url.pathname.match(/^\/playlist\/([A-Za-z0-9]+)(?:\/|$)/)?.[1] || ""; } catch { return ""; }
};
const render = (url = "") => {
  const id = playlistId(url); player.replaceChildren(); player.hidden = !id; input.value = id ? `https://open.spotify.com/playlist/${id}` : "";
  if (!id) return;
  const frame = document.createElement("iframe"); frame.src = `https://open.spotify.com/embed/playlist/${id}?utm_source=generator&theme=0`; frame.title = "Your Spotify playlist"; frame.loading = "lazy"; frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; player.append(frame);
};
const save = async (url) => {
  const next = { ...premiumDefaults(currentUser.uid), ...settings, uid: currentUser.uid, spotifyPlaylistUrl: url, updatedAt: serverTimestamp() };
  await setDoc(doc(db, "premiumSettings", currentUser.uid), next); settings = { ...next, updatedAt: null }; render(url);
};
onAuthStateChanged(auth, async (user) => {
  if (!user) { location.replace("index.html"); return; }
  currentUser = user;
  const [accessSnapshot, settingsSnapshot] = await Promise.all([getDoc(doc(db, "premiumAccess", user.uid)), getDoc(doc(db, "premiumSettings", user.uid))]);
  if (!accessSnapshot.exists() || !hasPremiumAccess(accessSnapshot.data())) { location.replace("premium.html"); return; }
  settings = { ...premiumDefaults(user.uid), ...(settingsSnapshot.exists() ? settingsSnapshot.data() : {}) };
  render(settings.spotifyPlaylistUrl); status.textContent = settings.spotifyPlaylistUrl ? "Your Premium playlist is live on your profile." : "Paste a Spotify playlist link to add it to your profile.";
});
form.addEventListener("submit", async (event) => { event.preventDefault(); const id = playlistId(input.value); if (!id) { status.textContent = "Paste a valid Spotify playlist link."; return; } const button = form.querySelector("button[type=submit]"); button.disabled = true; try { await save(`https://open.spotify.com/playlist/${id}`); status.textContent = "Your Premium playlist is live on your profile."; } catch { status.textContent = "Could not save that playlist. Please try again."; } finally { button.disabled = false; } });
remove.addEventListener("click", async () => { remove.disabled = true; try { await save(""); status.textContent = "Playlist removed from your profile."; } catch { status.textContent = "Could not remove that playlist."; } finally { remove.disabled = false; } });
