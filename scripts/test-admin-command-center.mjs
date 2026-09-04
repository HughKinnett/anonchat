import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, js, rules] = await Promise.all([
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../admin.css", import.meta.url), "utf8"),
  readFile(new URL("../admin.js", import.meta.url), "utf8"),
  readFile(new URL("../firestore.rules", import.meta.url), "utf8")
]);

for (const id of [
  "attention-open-reports", "attention-failed-jobs", "attention-service-health",
  "site-health-list", "notification-health", "feature-switches",
  "announcement-text", "announcement-active", "save-announcement", "clear-announcement",
  "moderation-history", "firebase-usage-note", "emergency-controls"
]) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `admin command center includes #${id}`);
}

for (const heading of [
  "Things needing attention", "Site health", "Site announcement", "Feature switches",
  "Moderation history", "Firebase usage", "Emergency controls"
]) assert.match(html, new RegExp(heading, "i"), `admin command center includes ${heading}`);

assert.match(css, /command-center-grid/, "command center has dedicated responsive layout styling");
assert.match(css, /status-chip/, "plain-English status chips are styled");
assert.match(css, /feature-switch-row/, "feature switches are styled as understandable rows");

assert.match(js, /siteSettings["'],\s*["']features/, "admin listens to the feature-settings document");
assert.match(js, /siteSettings["'],\s*["']announcement/, "admin listens to the announcement document");
assert.match(js, /registrationsEnabled/, "registration switch is wired");
assert.match(js, /postingEnabled/, "posting switch is wired");
assert.match(js, /commentsEnabled/, "comments switch is wired");
assert.match(js, /privateMessagingEnabled/, "private-message switch is wired");
assert.match(js, /temporaryChatsEnabled/, "temporary-chat switch is wired");
assert.match(js, /uploadsEnabled/, "upload switch is wired");
assert.match(js, /spotifyEmbedsEnabled/, "Spotify switch is wired");
assert.match(js, /updatedBy:\s*adminUid/, "settings writes record the administrator");
assert.match(js, /serverTimestamp\(\)/, "settings writes use trusted server timestamps");
assert.match(js, /window\.confirm\([\s\S]{0,300}(registration|posting|messaging)/i, "emergency disable actions require confirmation");
assert.match(js, /renderModerationHistory/, "moderation history is rendered");
assert.match(js, /Not checked here/, "unknown health is described honestly rather than reported as working");
assert.match(js, /Spark plan|free plan/i, "Firebase usage section explains the free-plan constraint");

assert.match(rules, /match \/siteSettings\/\{settingId\}[\s\S]{0,300}allow read: if isAdmin\(\);[\s\S]{0,300}allow (create|write): if isAdmin\(\)/,
  "only administrators can read/write dashboard settings");

console.log("admin command center policy tests passed");
