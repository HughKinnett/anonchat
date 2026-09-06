import { normalizeUserSettings } from './user-settings-policy.mjs';

export const resolveTheme = (theme = 'system', prefersDark = true) => {
  if (theme === 'light' || theme === 'dark') return theme;
  return prefersDark ? 'dark' : 'light';
};

export const appearanceClasses = value => {
  const settings = normalizeUserSettings(value);
  const classes = [
    `theme-${settings.theme === 'system' ? 'system' : settings.theme}`,
    `text-size-${settings.textSize}`
  ];
  if (settings.reduceMotion) classes.push('reduce-motion');
  if (settings.highContrast) classes.push('high-contrast');
  return classes;
};

export const resolvedAppearance = (value, prefersDark = true) => {
  const settings = normalizeUserSettings(value);
  return {
    theme: resolveTheme(settings.theme, prefersDark),
    themePreference: settings.theme,
    textSize: settings.textSize,
    reduceMotion: settings.reduceMotion,
    highContrast: settings.highContrast
  };
};
