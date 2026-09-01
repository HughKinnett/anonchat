export const FREE_AVATARS = Object.freeze(["", ...Array.from({ length: 8 }, (_, index) => `free-avatar-${index + 1}`)]);
export const FREE_COVERS = Object.freeze(["", ...Array.from({ length: 4 }, (_, index) => `free-cover-${index + 1}`)]);

export const applyFreeAvatar = (element, avatarId) => {
  const index = FREE_AVATARS.indexOf(avatarId) - 1;
  if (!element || index < 0) return false;
  element.classList.add("free-avatar-choice");
  element.dataset.freeArtwork = avatarId;
  element.style.setProperty("background-position", `${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 100}%`, "important");
  return true;
};

export const applyFreeCover = (element, coverId) => {
  const index = FREE_COVERS.indexOf(coverId) - 1;
  if (!element || index < 0) return false;
  element.classList.add("free-cover-choice");
  element.dataset.freeArtwork = coverId;
  element.style.setProperty("background-position", `${(index % 2) * 100}% ${Math.floor(index / 2) * 100}%`, "important");
  return true;
};
