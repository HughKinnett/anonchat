import { normalizeUserSettings } from './user-settings-policy.mjs';

export const resolveTheme = (theme = 'system', media = globalThis.matchMedia) => {
  if (theme === 'light' || theme === 'dark') return theme;
  try {
    return typeof media === 'function' && media('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
};

export const applyUserAppearance = (settings, root = globalThis.document?.documentElement, media = globalThis.matchMedia) => {
  if (!root) return null;
  const normalized = normalizeUserSettings(settings);
  const resolvedTheme = resolveTheme(normalized.theme, media);
  root.dataset.userTheme = resolvedTheme;
  root.dataset.userThemePreference = normalized.theme;
  root.dataset.userTextSize = normalized.textSize;
  root.classList.toggle('user-reduce-motion', normalized.reduceMotion);
  root.classList.toggle('user-high-contrast', normalized.highContrast);
  return { ...normalized, resolvedTheme };
};
