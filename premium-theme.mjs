import { PREMIUM_AVATARS, PREMIUM_COVERS, premiumDefaults } from "./premium-policy.mjs";

export const resolvedPremiumSettings = (uid, value = {}) => ({ ...premiumDefaults(uid), ...value });

export const applyPremiumTheme = element => element?.classList.remove("premium-full-theme");

export const avatarIndex = avatarId => PREMIUM_AVATARS.indexOf(avatarId) - 1;
export const applyPremiumAvatar = (element, avatarId) => {
  const rawIndex = avatarIndex(avatarId), female = avatarId?.startsWith("female-"), index = female ? rawIndex - 12 : rawIndex;
  if (!element || index < 0) return false;
  const column = index % 4, row = Math.floor(index / 4);
  element.classList.add("premium-avatar-choice");
  element.classList.toggle("premium-avatar-female", female);
  element.style.setProperty("--avatar-x", `${column * 100 / 3}%`);
  element.style.setProperty("--avatar-y", `${row * 100 / 2}%`);
  if (element.tagName === "IMG") { element.dataset.originalSrc ||= element.getAttribute("src") || ""; element.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="; }
  return true;
};
export const applyPremiumCover = (element, coverId) => {
  const index = PREMIUM_COVERS.indexOf(coverId) - 1; if (!element || index < 0) return false;
  element.classList.add("premium-cover-choice"); element.style.setProperty("--cover-x", `${(index % 4) * 100 / 3}%`); element.style.setProperty("--cover-y", `${Math.floor(index / 4) * 100 / 2}%`);
  if (element.tagName === "IMG") element.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  return true;
};
