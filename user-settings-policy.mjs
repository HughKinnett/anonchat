const NOTIFICATION_DEFAULTS = Object.freeze({
  reactions: true,
  comments: true,
  privateMessages: true,
  messageRequests: true,
  communityChatrooms: true,
  mentions: true,
  mutualRevealRequests: true
});

export const DEFAULT_USER_SETTINGS = Object.freeze({
  messageRequestMode: "everyone",
  notifications: NOTIFICATION_DEFAULTS,
  pauseAllNotifications: false,
  quietHours: Object.freeze({ enabled: false, start: "22:00", end: "07:00" }),
  theme: "system",
  reduceMotion: false,
  textSize: "default",
  highContrast: false
});

const MODES = new Set(["everyone", "following", "none"]);
const THEMES = new Set(["system", "light", "dark"]);
const TEXT_SIZES = new Set(["small", "default", "large", "extra-large"]);
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const validBoolean = (value, fallback) => typeof value === "boolean" ? value : fallback;
const validChoice = (value, allowed, fallback) => allowed.has(value) ? value : fallback;

const normalizeNotifications = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(NOTIFICATION_DEFAULTS).map(([key, fallback]) => [
    key,
    validBoolean(source[key], fallback)
  ]));
};

const normalizeQuietHours = (value) => {
  const fallback = DEFAULT_USER_SETTINGS.quietHours;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  if (typeof value.enabled !== "boolean" || !TIME_PATTERN.test(value.start ?? "") || !TIME_PATTERN.test(value.end ?? "")) {
    return { ...fallback };
  }
  return { enabled: value.enabled, start: value.start, end: value.end };
};

export const normalizeUserSettings = (value = {}) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    messageRequestMode: validChoice(source.messageRequestMode, MODES, DEFAULT_USER_SETTINGS.messageRequestMode),
    notifications: normalizeNotifications(source.notifications),
    pauseAllNotifications: validBoolean(source.pauseAllNotifications, DEFAULT_USER_SETTINGS.pauseAllNotifications),
    quietHours: normalizeQuietHours(source.quietHours),
    theme: validChoice(source.theme, THEMES, DEFAULT_USER_SETTINGS.theme),
    reduceMotion: validBoolean(source.reduceMotion, DEFAULT_USER_SETTINGS.reduceMotion),
    textSize: validChoice(source.textSize, TEXT_SIZES, DEFAULT_USER_SETTINGS.textSize),
    highContrast: validBoolean(source.highContrast, DEFAULT_USER_SETTINGS.highContrast)
  };
};
