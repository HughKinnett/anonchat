export const APPEARANCE_OPTIONS = Object.freeze(["system", "light", "dark"]);
export const TEXT_SCALE_OPTIONS = Object.freeze([0.9, 1, 1.15, 1.3]);

export const normalizeAppearance = (value) => APPEARANCE_OPTIONS.includes(value) ? value : "system";
export const normalizeTextScale = (value) => {
  const numeric = Number(value);
  return TEXT_SCALE_OPTIONS.includes(numeric) ? numeric : numeric > 1.3 ? 1.3 : numeric < 0.9 ? 0.9 : 1;
};

export const applyAccessibilityPreferences = (root, { appearance = "system", textScale = 1 } = {}) => {
  if (!root) return;
  const normalizedAppearance = normalizeAppearance(appearance);
  const normalizedScale = normalizeTextScale(textScale);
  root.dataset.appearance = normalizedAppearance;
  root.style.setProperty("--user-text-scale", String(normalizedScale));
};
