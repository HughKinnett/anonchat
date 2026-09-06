import assert from "node:assert/strict";
import { DEFAULT_USER_SETTINGS, normalizeUserSettings } from "../user-settings-policy.mjs";

const defaults = normalizeUserSettings();
assert.deepEqual(defaults, DEFAULT_USER_SETTINGS, "missing settings use production-safe defaults");
assert.equal(defaults.messageRequestMode, "everyone");
assert.equal(defaults.pauseAllNotifications, false);
assert.equal(defaults.theme, "system");
assert.equal(defaults.textSize, "default");
assert.equal(defaults.notifications.reactions, true);
assert.equal(defaults.notifications.comments, true);
assert.equal(defaults.notifications.privateMessages, true);
assert.equal(defaults.notifications.messageRequests, true);
assert.equal(defaults.notifications.communityChatrooms, true);
assert.equal(defaults.notifications.mentions, true);
assert.equal(defaults.notifications.mutualRevealRequests, true);

const customized = normalizeUserSettings({
  messageRequestMode: "following",
  notifications: { reactions: false, mentions: false, unknown: false },
  pauseAllNotifications: true,
  quietHours: { enabled: true, start: "23:30", end: "06:15" },
  theme: "dark",
  reduceMotion: true,
  textSize: "extra-large",
  highContrast: true,
  unknown: "discard-me"
});
assert.equal(customized.messageRequestMode, "following");
assert.equal(customized.notifications.reactions, false);
assert.equal(customized.notifications.mentions, false);
assert.equal(customized.notifications.comments, true, "unspecified notification categories retain defaults");
assert.equal("unknown" in customized.notifications, false, "unknown notification categories are discarded");
assert.equal(customized.pauseAllNotifications, true);
assert.deepEqual(customized.quietHours, { enabled: true, start: "23:30", end: "06:15" });
assert.equal(customized.theme, "dark");
assert.equal(customized.reduceMotion, true);
assert.equal(customized.textSize, "extra-large");
assert.equal(customized.highContrast, true);
assert.equal("unknown" in customized, false, "unknown top-level fields are discarded");

const invalid = normalizeUserSettings({
  messageRequestMode: "friends-only",
  notifications: { reactions: "no", comments: 0 },
  pauseAllNotifications: "yes",
  quietHours: { enabled: "yes", start: "25:99", end: "7am" },
  theme: "neon",
  reduceMotion: 1,
  textSize: "huge",
  highContrast: "true"
});
assert.equal(invalid.messageRequestMode, "everyone");
assert.equal(invalid.notifications.reactions, true);
assert.equal(invalid.notifications.comments, true);
assert.equal(invalid.pauseAllNotifications, false);
assert.deepEqual(invalid.quietHours, DEFAULT_USER_SETTINGS.quietHours);
assert.equal(invalid.theme, "system");
assert.equal(invalid.reduceMotion, false);
assert.equal(invalid.textSize, "default");
assert.equal(invalid.highContrast, false);

console.log("user settings policy tests passed");
