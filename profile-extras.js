import { auth, db } from "./firebase-config.js";
import { BADGE_CATALOG, badgeById } from "./badge-policy.mjs";
import { normalizeProfileExtras, normalizePinnedPostIds } from "./user-experience-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const targetFromUrl = () => new URLSearchParams(location.search).get("uid");
const $ = (id) => document.getElementById(id);
let viewer = null;
let targetUid = "";
let extras = normalizeProfileExtras();
let pinnedPostIds = [];
let badgeDefinitions = [...BADGE_CATALOG];
let badgeAwards = [];
let stopExtras = () => {};
let stopAwards = () => {};

const toast = (message) => {
  const node = document.createElement("div"); node.className = "ux-toast"; node.textContent = message; document.body.append(node);
  setTimeout(() => node.remove(), 1700);
};

const pinToken = (collectionName, postId) => `${collectionName}__${postId}`;
const unpinToken = (token) => {
  const index = token.indexOf("__");
  return index > 0 ? { collectionName: token.slice(0, index), postId: token.slice(index + 2) } : { collectionName: "posts", postId: token };
};

const renderAbout = () => {
  const about = $("profile-about"); const status = $("profile-status-line"); const interests = $("profile-interests");
  if (about) about.textContent = extras.bio || "No bio added yet.";
  if (status) { status.textContent = extras.status || ""; status.hidden = !extras.status; }
  if (interests) {
    interests.replaceChildren(...extras.interests.map((interest) => {
      const span = document.createElement("span"); span.className = "profile-interest"; span.textContent = interest; return span;
    }));
    if (!extras.interests.length) { const empty = document.createElement("span"); empty.className = "ux-muted"; empty.textContent = "No interests listed yet."; interests.append(empty); }
  }
};

const badgeDialog = (() => {
  const dialog = document.createElement("dialog"); dialog.className = "ux-dialog"; dialog.setAttribute("aria-label", "Badge details"); document.body.append(dialog); return dialog;
})();
const showBadge = (definition, award) => {
  badgeDialog.replaceChildren();
  const image = document.createElement("img"); image.src = definition.image; image.alt = `${definition.name} badge`; image.width = 120; image.height = 120;
  const title = document.createElement("h2"); title.textContent = definition.name;
  const description = document.createElement("p"); description.textContent = definition.description;
  const earned = document.createElement("p"); earned.className = "ux-muted"; earned.textContent = award?.awardedAt?.toDate ? `Earned ${award.awardedAt.toDate().toLocaleDateString()}` : "Earned on AnonChat";
  const close = document.createElement("button"); close.type = "button"; close.className = "secondary-button"; close.textContent = "Close"; close.onclick = () => badgeDialog.close();
  badgeDialog.append(image, title, description, earned, close); badgeDialog.showModal();
};

const renderBadges = () => {
  const host = $("profile-badges"); if (!host) return;
  const cards = badgeAwards.map((award) => {
    const definition = badgeById(award.badgeId, badgeDefinitions) || badgeById(award.badgeId) || { name: award.badgeId, description: "AnonChat achievement", image: "badge-community-helper.svg" };
    const button = document.createElement("button"); button.type = "button"; button.className = "profile-badge"; button.title = definition.description;
    const image = document.createElement("img"); image.src = definition.image; image.alt = `${definition.name} badge`;
    const name = document.createElement("strong"); name.textContent = definition.name;
    button.append(image, name); button.onclick = () => showBadge(definition, award); return button;
  });
  host.replaceChildren(...cards);
  if (!cards.length) { const empty = document.createElement("p"); empty.className = "ux-muted"; empty.textContent = "No badges earned yet."; host.append(empty); }
};

const renderPinned = async () => {
  const host = $("profile-pinned-posts"); if (!host) return;
  const nodes = [];
  for (const token of pinnedPostIds.slice(0, 3)) {
    const { collectionName, postId } = unpinToken(token);
    if (!["posts", "communityPosts"].includes(collectionName)) continue;
    try {
      const snapshot = await getDoc(doc(db, collectionName, postId));
      if (!snapshot.exists() || snapshot.data().authorId !== targetUid || snapshot.data().moderationState === "hidden") continue;
      const post = snapshot.data();
      const link = document.createElement("a"); link.className = "pinned-post-card"; link.href = `timeline.html#post-${encodeURIComponent(postId)}`;
      const label = document.createElement("strong"); label.textContent = "📌 Pinned post";
      const text = document.createElement("p"); text.textContent = String(post.content || "Post").slice(0, 220);
      link.append(label, text); nodes.push(link);
    } catch {}
  }
  host.replaceChildren(...nodes);
  if (!nodes.length) { const empty = document.createElement("p"); empty.className = "ux-muted"; empty.textContent = "No pinned posts yet."; host.append(empty); }
};

const renderEditor = () => {
  const form = $("profile-extras-form"); if (!form || !viewer) return;
  form.hidden = viewer.uid !== targetUid;
  if (form.hidden) return;
  $("profile-bio-input").value = extras.bio;
  $("profile-status-input").value = extras.status;
  $("profile-interests-input").value = extras.interests.join(", ");
};

const saveExtras = async () => {
  if (!viewer || viewer.uid !== targetUid) return;
  const next = normalizeProfileExtras({
    bio: $("profile-bio-input")?.value,
    status: $("profile-status-input")?.value,
    interests: String($("profile-interests-input")?.value || "").split(",")
  });
  await setDoc(doc(db, "userExperienceProfiles", viewer.uid), { uid: viewer.uid, ...next, pinnedPostIds: normalizePinnedPostIds(pinnedPostIds), updatedAt: serverTimestamp() }, { merge: true });
  toast("Profile details saved.");
};

const updatePins = async (next) => {
  if (!viewer || viewer.uid !== targetUid) return;
  pinnedPostIds = normalizePinnedPostIds(next);
  await setDoc(doc(db, "userExperienceProfiles", viewer.uid), { uid: viewer.uid, pinnedPostIds, updatedAt: serverTimestamp() }, { merge: true });
  await renderPinned(); decoratePinButtons();
};

const decoratePinButtons = () => {
  if (!viewer || viewer.uid !== targetUid) return;
  document.querySelectorAll("#profile-feed .feed-item[data-post-id]").forEach((item) => {
    const actions = item.querySelector(".post-actions"); if (!actions) return;
    let button = actions.querySelector(".pin-post-button");
    if (!button) { button = document.createElement("button"); button.type = "button"; button.className = "ux-small-button pin-post-button"; actions.append(button); }
    const token = pinToken(item.dataset.postCollection || "posts", item.dataset.postId);
    const active = pinnedPostIds.includes(token);
    button.textContent = active ? "📌 Unpin" : "📌 Pin";
    button.disabled = !active && pinnedPostIds.length >= 3;
    button.onclick = () => void updatePins(active ? pinnedPostIds.filter((value) => value !== token) : [...pinnedPostIds, token]);
  });
};

const renderShare = () => {
  const host = $("profile-share-card"); if (!host || !targetUid) return;
  const url = new URL("profile.html", location.href); url.searchParams.set("uid", targetUid);
  host.replaceChildren();
  const heading = document.createElement("h2"); heading.textContent = "Share this profile";
  const actions = document.createElement("div"); actions.className = "ux-actions";
  const share = document.createElement("button"); share.type = "button"; share.className = "secondary-button"; share.textContent = "↗ Share profile";
  share.onclick = async () => { if (navigator.share) { try { await navigator.share({ title: "AnonChat profile", url: url.href }); return; } catch (error) { if (error?.name === "AbortError") return; } } await navigator.clipboard?.writeText?.(url.href); toast("Profile link copied."); };
  const qr = document.createElement("button"); qr.type = "button"; qr.className = "secondary-button"; qr.textContent = "Show QR code";
  const image = document.createElement("img"); image.className = "profile-share-qr"; image.alt = "QR code for this AnonChat profile"; image.hidden = true;
  qr.onclick = () => { image.hidden = !image.hidden; if (!image.src) image.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url.href)}`; };
  actions.append(share, qr); host.append(heading, actions, image);
};

const start = async (user) => {
  viewer = user; targetUid = targetFromUrl() || user.uid; renderShare();
  try {
    const definitions = await getDocs(query(collection(db, "badgeDefinitions"), limit(50)));
    if (!definitions.empty) badgeDefinitions = [...BADGE_CATALOG, ...definitions.docs.map((entry) => ({ id: entry.id, ...entry.data() }))]
      .filter((badge, index, list) => list.findIndex((candidate) => candidate.id === badge.id) === index || index >= BADGE_CATALOG.length);
  } catch {}
  stopExtras(); stopAwards();
  stopExtras = onSnapshot(doc(db, "userExperienceProfiles", targetUid), (snapshot) => {
    const data = snapshot.exists() ? snapshot.data() : {};
    extras = normalizeProfileExtras(data); pinnedPostIds = normalizePinnedPostIds(data.pinnedPostIds || []);
    renderAbout(); renderEditor(); void renderPinned(); decoratePinButtons();
  });
  stopAwards = onSnapshot(query(collection(db, "userBadges", targetUid, "awards"), limit(50)), (snapshot) => {
    badgeAwards = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })); renderBadges();
  });
  const observer = new MutationObserver(decoratePinButtons); observer.observe($("profile-feed") || document.body, { childList: true, subtree: true });
};

$("profile-extras-form")?.addEventListener("submit", (event) => { event.preventDefault(); void saveExtras().catch(() => toast("Could not save profile details.")); });
onAuthStateChanged(auth, (user) => { if (user) void start(user); });
