import { auth, db } from "./firebase-config.js";
import { listBadgeTypes, listUserBadges } from "./badge-firestore.mjs";
import { sortEarnedBadges } from "./badge-policy.mjs";

const targetUserId = new URLSearchParams(window.location.search).get("uid");
const entryButton = document.getElementById("profile-badges-open");
const collectionDialog = document.getElementById("profile-badges-collection-dialog");
const collection = document.getElementById("profile-badges-collection");
const collectionEmpty = document.getElementById("profile-badges-collection-empty");
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
let ownerView = false;

const profileUnavailable = () => profileName?.textContent === "Unavailable profile";
const hideEntry = () => {
  if (entryButton) entryButton.hidden = true;
  collectionDialog?.close?.();
  dialog?.close?.();
};

const earnedLabel = (badge) => {
  if (badge.id === "premium-member") return "Premium badge entitlement is active";
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

const openBadgeCollection = () => {
  if (!collectionDialog || !collection || profileUnavailable()) return;
  collection.replaceChildren(...sortEarnedBadges(allBadges).map(collectionCard));
  if (collectionEmpty) collectionEmpty.hidden = allBadges.length !== 0;
  collectionDialog.showModal?.();
};

const load = async () => {
  hideEntry();
  await auth.authStateReady();
  const viewerUid = auth.currentUser?.uid || "";
  ownerView = Boolean(viewerUid && targetUserId === viewerUid);
  if (!targetUserId || profileUnavailable()) return;

  if (ownerView && entryButton) entryButton.hidden = false;

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
    if (entryButton) entryButton.hidden = false;
  } catch {
    allBadges = [];
    if (!ownerView) hideEntry();
  }
};

entryButton?.addEventListener("click", openBadgeCollection);
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
  if (profileUnavailable()) hideEntry();
}) : null;
observer?.observe(profileName, { childList: true, characterData: true, subtree: true });

load();
