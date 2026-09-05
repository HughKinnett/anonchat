import { auth, db } from "./firebase-config.js";
import { normalizeProfilePrivacy, resolveProfileVisibility } from "./profile-privacy-policy.mjs";
import { buildProfileShareData, safeProfileQrPayload } from "./profile-share.mjs";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const targetUserId = new URLSearchParams(location.search).get("uid");
const controls = document.getElementById("profile-privacy-controls");
const privacyInputs = [...document.querySelectorAll("[data-profile-privacy]")];
const privateNote = document.getElementById("profile-private-note");
const shareButton = document.getElementById("profile-share-button");
const qrButton = document.getElementById("profile-qr-button");
const qrDialog = document.getElementById("profile-qr-dialog");
const qrClose = document.getElementById("profile-qr-close");
const qrCanvas = document.getElementById("profile-qr-canvas");
const qrUrl = document.getElementById("profile-qr-url");

let viewer = null;
let profile = null;
let featureSettings = { profileQrEnabled: true };

const setStatus = (message, error = false) => {
  const status = document.getElementById("profile-status");
  if (!status) return;
  status.textContent = message;
  status.style.color = error ? "#fca5a5" : "inherit";
};

const markPrivate = (node, hidden) => {
  if (!node) return;
  node.setAttribute("data-profile-private-hidden", hidden ? "true" : "false");
};

const applyVisibility = () => {
  if (!profile || !viewer) return;
  const privacy = normalizeProfilePrivacy(profile.profilePrivacy);
  const ownerView = viewer.uid === targetUserId;
  const unavailable = document.getElementById("profile-name")?.textContent === "Unavailable profile";
  const visibility = resolveProfileVisibility({
    ownerUid: targetUserId,
    viewerUid: viewer.uid,
    blocked: unavailable,
    privacy
  });

  controls.hidden = !ownerView;
  privacyInputs.forEach((input) => {
    input.checked = privacy[input.dataset.profilePrivacy];
  });

  markPrivate(document.querySelector(".profile-posts-section"), !visibility.posts);
  markPrivate(document.getElementById("profile-badges-section"), !visibility.badges);
  markPrivate(document.querySelector(".profile-connections-links"), !visibility.followersFollowing);
  document.querySelectorAll("[data-profile-activity]").forEach((node) => markPrivate(node, !visibility.activity));

  if (qrButton) {
    const enabled = featureSettings.profileQrEnabled !== false;
    qrButton.disabled = !enabled;
    qrButton.title = enabled ? "" : "Profile QR is temporarily unavailable.";
  }

  if (ownerView && privateNote) {
    const hidden = Object.entries(privacy).filter(([, value]) => !value).map(([key]) => key);
    privateNote.hidden = hidden.length === 0;
    privateNote.textContent = hidden.length
      ? "You can still see sections you have hidden from other users."
      : "";
  }
};

const loadFeatures = async () => {
  try {
    const snapshot = await getDoc(doc(db, "siteSettings", "features"));
    if (snapshot.exists()) featureSettings = { ...featureSettings, ...snapshot.data() };
  } catch {
    featureSettings = { profileQrEnabled: true };
  }
};

const loadProfile = async () => {
  if (!targetUserId) return;
  try {
    const snapshot = await getDoc(doc(db, "users", targetUserId));
    profile = snapshot.exists() ? snapshot.data() : null;
    if (profile) applyVisibility();
  } catch {
    setStatus("Could not load profile privacy settings.", true);
  }
};

privacyInputs.forEach((input) => input.addEventListener("change", async () => {
  if (!viewer || viewer.uid !== targetUserId || !profile) return;
  const key = input.dataset.profilePrivacy;
  const previous = normalizeProfilePrivacy(profile.profilePrivacy);
  const next = { ...previous, [key]: input.checked };
  input.disabled = true;
  try {
    await updateDoc(doc(db, "users", targetUserId), { profilePrivacy: next });
    profile = { ...profile, profilePrivacy: next };
    applyVisibility();
  } catch {
    input.checked = previous[key];
    setStatus("Could not save that privacy setting.", true);
  } finally {
    input.disabled = false;
  }
}));

const shareData = () => buildProfileShareData({
  profileId: targetUserId,
  username: profile?.username || "",
  baseUrl: location.href
});

shareButton?.addEventListener("click", async () => {
  if (!profile) return;
  const data = shareData();
  try {
    if (navigator.share) {
      await navigator.share(data);
      return;
    }
    await navigator.clipboard.writeText(data.url);
    setStatus("Profile link copied.");
  } catch (error) {
    if (error?.name === "AbortError") return;
    try {
      await navigator.clipboard.writeText(data.url);
      setStatus("Profile link copied.");
    } catch {
      setStatus("Could not share this profile.", true);
    }
  }
});

const renderQr = async () => {
  const payload = safeProfileQrPayload({ profileId: targetUserId, baseUrl: location.href });
  qrUrl.textContent = payload;
  qrCanvas.replaceChildren();
  const canvas = document.createElement("canvas");
  qrCanvas.append(canvas);
  if (!globalThis.QRCode?.toCanvas) throw new Error("QR renderer unavailable");
  await globalThis.QRCode.toCanvas(canvas, payload, { width: 280, margin: 2 });
};

qrButton?.addEventListener("click", async () => {
  if (!profile || !qrDialog) return;
  if (featureSettings.profileQrEnabled === false) {
    setStatus("Profile QR is temporarily unavailable. You can still use Share.", true);
    return;
  }
  try {
    await renderQr();
    qrDialog.showModal();
  } catch {
    setStatus("Could not render the profile QR code. You can still use Share.", true);
  }
});
qrClose?.addEventListener("click", () => qrDialog?.close());
qrDialog?.addEventListener("click", (event) => {
  if (event.target === qrDialog) qrDialog.close();
});

const initialize = async () => {
  await auth.authStateReady();
  viewer = auth.currentUser;
  if (!viewer || !targetUserId) return;
  await loadFeatures();
  await loadProfile();
};
void initialize();

const visibilityObserver = new MutationObserver(() => applyVisibility());
const observed = [
  document.getElementById("profile-badges-section"),
  document.querySelector(".profile-posts-section"),
  document.querySelector(".profile-connections-links")
].filter(Boolean);
observed.forEach((node) => visibilityObserver.observe(node, { attributes: true, attributeFilter: ["hidden"] }));
