import { resolvedAppearance } from './appearance-accessibility-policy.mjs';

const prefersDarkQuery = '(prefers-color-scheme: dark)';

const mediaQuery = media => {
  try {
    return typeof media === 'function' ? media(prefersDarkQuery) : null;
  } catch {
    return null;
  }
};

export const applyUserAppearance = (settings, root = globalThis.document?.documentElement, media = globalThis.matchMedia) => {
  if (!root) return null;
  const query = mediaQuery(media);
  const appearance = resolvedAppearance(settings, query?.matches !== false);

  root.dataset.theme = appearance.theme;
  root.dataset.textSize = appearance.textSize;
  root.dataset.themePreference = appearance.themePreference;
  root.classList.toggle('reduce-motion', appearance.reduceMotion);
  root.classList.toggle('high-contrast', appearance.highContrast);

  // Transitional aliases keep existing Phase C Settings CSS stable while shared styles migrate.
  root.dataset.userTheme = appearance.theme;
  root.dataset.userTextSize = appearance.textSize;
  root.classList.toggle('user-reduce-motion', appearance.reduceMotion);
  root.classList.toggle('user-high-contrast', appearance.highContrast);

  return appearance;
};

export const watchUserAppearance = (settings, root = globalThis.document?.documentElement, media = globalThis.matchMedia) => {
  const query = mediaQuery(media);
  const reapply = () => applyUserAppearance(settings, root, media);
  reapply();

  if (settings?.theme !== 'system' || !query?.addEventListener) return () => {};
  query.addEventListener('change', reapply);
  return () => query.removeEventListener?.('change', reapply);
};
