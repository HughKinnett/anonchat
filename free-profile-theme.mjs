export const FREE_AVATARS = Object.freeze(["", ...Array.from({ length: 8 }, (_, index) => `free-avatar-${index + 1}`)]);
export const FREE_COVERS = Object.freeze(["", ...Array.from({ length: 4 }, (_, index) => `free-cover-${index + 1}`)]);

export const applyFreeAvatar = (element, avatarId) => {
  const index = FREE_AVATARS.indexOf(avatarId) - 1;
  if (!element || index < 0) return false;
  element.classList.add("free-avatar-choice");
  element.style.setProperty("--free-avatar-x", `${(index % 4) * 100 / 3}%`);
  element.style.setProperty("--free-avatar-y", `${Math.floor(index / 4) * 100}%`);
  return true;
};

export const applyFreeCover = (element, coverId) => {
  const index = FREE_COVERS.indexOf(coverId) - 1;
  if (!element || index < 0) return false;
  element.classList.add("free-cover-choice");
  element.style.setProperty("--free-cover-x", `${(index % 2) * 100}%`);
  element.style.setProperty("--free-cover-y", `${Math.floor(index / 2) * 100}%`);
  return true;
};
