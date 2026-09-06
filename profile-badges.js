import { db } from "./firebase-config.js";
import { listBadgeTypes, listUserBadges } from "./badge-firestore.mjs";
import { PROFILE_BADGE_PREVIEW_LIMIT, previewEarnedBadges, sortEarnedBadges } from "./badge-policy.mjs";

const targetUserId = new URLSearchParams(window.location.search).get("uid");
const section = document.getElementById("profile-badges-section");
const list = document.getElementById("profile-badges-list");
const viewAll = document.getElementById("profile-badges-view-all");
const collectionDialog = document.getElementById("profile-badges-collection-dialog");
const collection = document.getElementById("profile-badges-collection");
const collectionClose = document.getElementById("profile-badges-collection-close");
const dialog = document.getElementById("profile-badge-dialog");
const dialogImage = document.getElementById("profile-badge-dialog-image");
const dialogName = document.getElementById("profile-badge-dialog-name");
const dialogTier = document.getElementById("profile-badge-dialog-tier");
const dialogDescription = document.getElementById("profile-badge-dialog-description");
const dialogRequirement = document.getElementById("profile-badge-dialog-requirement");
const dialogEarned = document.getElementById("profile-badge-dialog-earned");
const dialogClose = document.getElementById("profile-badge-dialog-close");
const profileName = document.getElementById("profile-name");
const PLACEHOLDER_BADGE = "anonchat-anonymous.png";
let allBadges = [];

const profileUnavailable = () => profileName?.textContent === "Unavailable profile";
const hideGallery = () => {
  if (list) list.replaceChildren();
  if (collection) collection.replaceChildren();
  if (section) section.hidden = true;
  if (viewAll) viewAll.hidden = true;
  collectionDialog?.close?.();
  dialog?.close?.();
};

const earnedLabel = (badge) => {
  if (badge.id === "premium-member") return "Shown while paid Premium is active";
  const earnedAt = badge.earnedAt;
  const date = earnedAt?.toDate?.() || (earnedAt instanceof Date ? earnedAt : null);
  return date ? `Earned ${date.toLocaleDateString()}` : "Earned date unavailable";
};

const requirementLabel = (badge) => {
  if (badge.milestoneThreshold) return `${badge.milestoneMetric} ≥ ${badge.milestoneThreshold}`;
  return badge.milestoneMetric || "Special AnonChat achievement";
};

const openBadgeDetail = (badge) => {
  if (!dialog || profileUnavailable()) return;
  if (dialogImage) {
    dialogImage.src = badge.imageUrl || PLACEHOLDER_BADGE;
    dialogImage.alt = `${badge.name} badge`;
  }
  if (dialogName) dialogName.textContent = badge.name;
  if (dialogTier) dialogTier.textContent = `${badge.tier} tier`;
  if (dialogDescription) dialogDescription.textContent = badge.description;
  if (dialogRequirement) dialogRequirement.textContent = `Requirement: ${requirementLabel(badge)}`;
  if (dialogEarned) dialogEarned.textContent = earnedLabel(badge);
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

const collectionCard = (badge) => {
  const card = document.createElement("article");
  card.className = "profile-badge-collection-card";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "profile-badge-collection-art";
  button.setAttribute("aria-label", `View ${badge.name} badge details`);
  const image = document.createElement("img");
  image.src = badge.imageUrl || PLACEHOLDER_BADGE;
  image.alt = `${badge.name} badge`;
  image.loading = "lazy";
  image.addEventListener("error", () => { image.src = PLACEHOLDER_BADGE; }, { once: true });
  button.append(image);
  button.addEventListener("click", () => openBadgeDetail(badge));

  const info = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = badge.name;
  const tier = document.createElement("span");
  tier.textContent = `${badge.tier} tier`;
  const description = document.createElement("p");
  description.textContent = badge.description;
  const requirement = document.createElement("small");
  requirement.textContent = `Requirement: ${requirementLabel(badge)}`;
  const earned = document.createElement("small");
  earned.textContent = earnedLabel(badge);
  info.append(name, tier, description, requirement, earned);
  card.append(button, info);
  return card;
};

const render = () => {
  if (!section || !list || profileUnavailable()) {
    hideGallery();
    return;
  }
  const visible = previewEarnedBadges(allBadges);
  list.replaceChildren(...visible.map(badgeButton));
  section.hidden = allBadges.length === 0;
  if (viewAll) viewAll.hidden = allBadges.length <= PROFILE_BADGE_PREVIEW_LIMIT;
};

const openBadgeCollection = () => {
  if (!collectionDialog || !collection || profileUnavailable() || !allBadges.length) return;
  collection.replaceChildren(...sortEarnedBadges(allBadges).map(collectionCard));
  collectionDialog.showModal?.();
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

viewAll?.addEventListener("click", openBadgeCollection);
collectionClose?.addEventListener("click", () => collectionDialog?.close?.());
collectionDialog?.addEventListener("click", (event) => {
  if (event.target === collectionDialog) collectionDialog.close?.();
});
dialogClose?.addEventListener("click", () => dialog?.close?.());
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close?.();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (dialog?.open) dialog.close?.();
  if (collectionDialog?.open) collectionDialog.close?.();
});

const observer = profileName ? new MutationObserver(() => {
  if (profileUnavailable()) hideGallery();
}) : null;
observer?.observe(profileName, { childList: true, characterData: true, subtree: true });

load();
