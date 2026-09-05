import { db } from "./firebase-config.js";
import { listBadgeTypes, listUserBadges } from "./badge-firestore.mjs";
import { PROFILE_BADGE_PREVIEW_LIMIT, previewEarnedBadges, sortEarnedBadges } from "./badge-policy.mjs";

const targetUserId = new URLSearchParams(window.location.search).get("uid");
const section = document.getElementById("profile-badges-section");
const list = document.getElementById("profile-badges-list");
const viewAll = document.getElementById("profile-badges-view-all");
const dialog = document.getElementById("profile-badge-dialog");
const dialogImage = document.getElementById("profile-badge-dialog-image");
const dialogName = document.getElementById("profile-badge-dialog-name");
const dialogDescription = document.getElementById("profile-badge-dialog-description");
const dialogEarned = document.getElementById("profile-badge-dialog-earned");
const dialogClose = document.getElementById("profile-badge-dialog-close");
const profileName = document.getElementById("profile-name");
const PLACEHOLDER_BADGE = "anonchat-anonymous.png";
let allBadges = [];
let expanded = false;

const profileUnavailable = () => profileName?.textContent === "Unavailable profile";
const hideGallery = () => {
  if (list) list.replaceChildren();
  if (section) section.hidden = true;
  if (viewAll) viewAll.hidden = true;
  dialog?.close?.();
};

const earnedLabel = (earnedAt) => {
  const date = earnedAt?.toDate?.() || (earnedAt instanceof Date ? earnedAt : null);
  return date ? `Earned ${date.toLocaleDateString()}` : "Earned date unavailable";
};

const openBadgeDetail = (badge) => {
  if (!dialog || profileUnavailable()) return;
  if (dialogImage) {
    dialogImage.src = badge.imageUrl || PLACEHOLDER_BADGE;
    dialogImage.alt = `${badge.name} badge`;
  }
  if (dialogName) dialogName.textContent = badge.name;
  if (dialogDescription) dialogDescription.textContent = badge.description;
  if (dialogEarned) dialogEarned.textContent = earnedLabel(badge.earnedAt);
  dialog.showModal?.();
};

const badgeButton = (badge) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "profile-badge-card";
  button.setAttribute("aria-label", `View ${badge.name} badge details`);

  const image = document.createElement("img");
  image.src = badge.imageUrl || PLACEHOLDER_BADGE;
  image.alt = "";
  image.loading = "lazy";
  image.addEventListener("error", () => { image.src = PLACEHOLDER_BADGE; }, { once: true });

  const name = document.createElement("span");
  name.textContent = badge.name;
  button.append(image, name);
  button.addEventListener("click", () => openBadgeDetail(badge));
  return button;
};

const render = () => {
  if (!section || !list || profileUnavailable()) {
    hideGallery();
    return;
  }
  const visible = expanded ? sortEarnedBadges(allBadges) : previewEarnedBadges(allBadges);
  list.replaceChildren(...visible.map(badgeButton));
  section.hidden = allBadges.length === 0;
  if (viewAll) {
    viewAll.hidden = allBadges.length <= PROFILE_BADGE_PREVIEW_LIMIT;
    viewAll.textContent = expanded ? "Show featured badges" : "View all badges";
  }
};

const load = async () => {
  hideGallery();
  if (!targetUserId || profileUnavailable()) return;
  try {
    const [assignments, definitions] = await Promise.all([
      listUserBadges(db, targetUserId),
      listBadgeTypes(db, { includeInactive: true })
    ]);
    if (profileUnavailable()) return;
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
    allBadges = assignments
      .map((assignment) => {
        const definition = definitionById.get(assignment.badgeId);
        return definition ? { ...definition, ...assignment } : null;
      })
      .filter(Boolean);
    render();
  } catch {
    hideGallery();
  }
};

viewAll?.addEventListener("click", () => {
  expanded = !expanded;
  render();
});
dialogClose?.addEventListener("click", () => dialog?.close?.());
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close?.();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dialog?.open) dialog.close?.();
});

const observer = profileName ? new MutationObserver(() => {
  if (profileUnavailable()) hideGallery();
}) : null;
observer?.observe(profileName, { childList: true, characterData: true, subtree: true });

load();
