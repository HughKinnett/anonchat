import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  normalizeProfileExtras,
  normalizePinnedPostIds,
  normalizeNotificationPreferences,
  canReceiveMessageRequest,
  quietHoursActive,
  normalizePostMedia,
  recentViewKey
} from "../user-experience-policy.mjs";
import { BADGE_CATALOG, normalizeBadgeAward } from "../badge-policy.mjs";
import { extractHashtags, rankDiscoveryPosts } from "../discovery-policy.mjs";
import { normalizeMessageReaction, normalizeReplyReference, canUnsendMessage } from "../messaging-extras-policy.mjs";
import { normalizeAppearance, normalizeTextScale } from "../accessibility-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = async (name) => readFile(path.join(root, name), "utf8");

// Profile extras and privacy-safe presentation.
assert.deepEqual(normalizeProfileExtras({ bio: " hi ", status: " online ", interests: ["Music", " gaming "] }), {
  bio: "hi", status: "online", interests: ["Music", "gaming"]
});
assert.deepEqual(normalizePinnedPostIds(["a", "b", "a", "c", "d"]), ["a", "b", "c"]);
assert.equal(recentViewKey("posts", "abc"), "posts:abc");

// Badge catalog is visual and original to AnonChat.
assert.ok(BADGE_CATALOG.length >= 8, "badge catalog has the approved starting set");
for (const badge of BADGE_CATALOG) {
  assert.match(badge.id, /^[a-z0-9-]+$/);
  assert.ok(badge.name && badge.description && badge.image, "each badge has visible artwork and copy");
  assert.ok(badge.image.startsWith("badge-"), "badge artwork uses AnonChat-owned local assets");
}
assert.equal(normalizeBadgeAward({ badgeId: "community-helper", userId: "u1" }).badgeId, "community-helper");

// Discovery and topics.
assert.deepEqual(extractHashtags("Talk #Music and #music with #Gaming_today"), ["music", "gaming_today"]);
const ranked = rankDiscoveryPosts([
  { id: "old", reactions: 20, comments: 10, createdAt: 1 },
  { id: "new", reactions: 4, comments: 4, createdAt: Date.now() }
], Date.now());
assert.equal(ranked[0].id, "new", "fresh engagement is favored for discovery");

// Messaging and notification privacy controls.
assert.deepEqual(normalizeMessageReaction("❤️"), "❤️");
assert.deepEqual(normalizeReplyReference({ messageId: "m1", senderId: "u2" }), { messageId: "m1", senderId: "u2" });
assert.equal(canUnsendMessage({ senderId: "u1", createdAt: Date.now() - 1000 }, "u1", Date.now()), true);
assert.equal(canUnsendMessage({ senderId: "u2", createdAt: Date.now() - 1000 }, "u1", Date.now()), false);
assert.equal(canReceiveMessageRequest("nobody", { followsViewer: true, viewerFollows: true }), false);
assert.equal(canReceiveMessageRequest("mutual", { followsViewer: true, viewerFollows: true }), true);
const prefs = normalizeNotificationPreferences({ reactions: false, mentions: true });
assert.equal(prefs.reactions, false);
assert.equal(prefs.mentions, true);
assert.equal(quietHoursActive({ enabled: true, start: "22:00", end: "07:00" }, new Date("2026-09-05T23:00:00")), true);

// Media and accessibility caps.
assert.equal(normalizePostMedia(["a", "b", "c", "d", "e"]).length, 4);
assert.equal(normalizeAppearance("dark"), "dark");
assert.equal(normalizeAppearance("unknown"), "system");
assert.equal(normalizeTextScale(2), 1.3);

const profileHtml = await source("profile.html");
const timelineHtml = await source("timeline.html");
const communityHtml = await source("community.html");
const adminHtml = await source("admin.html");
const sw = await source("sw.js");
const androidGradle = await source("android/app/build.gradle");

for (const id of ["profile-about", "profile-status-line", "profile-interests", "profile-badges", "profile-pinned-posts", "profile-share-card"]) {
  assert.match(profileHtml, new RegExp(`id=["']${id}["']`), `profile exposes ${id}`);
}
assert.match(timelineHtml, /discover\.html/, "timeline navigation links to discovery");
assert.match(timelineHtml, /saved\.html/, "timeline navigation links to saved posts");
assert.match(communityHtml, /group-chats-panel/, "community exposes persistent private groups");
assert.match(communityHtml, /notification-preferences/, "community exposes notification controls");
assert.match(communityHtml, /message-request-privacy/, "community exposes request privacy");
assert.match(communityHtml, /appearance-select/, "community exposes appearance controls");
assert.match(communityHtml, /text-size-select/, "community exposes text-size controls");
assert.match(adminHtml, /badge-management/, "admin can manage badges");
assert.match(adminHtml, /user-experience-controls/, "admin can control new experience features");
assert.match(sw, /discover\.html/, "discovery is part of the offline app graph");
assert.match(sw, /saved\.html/, "saved posts are part of the offline app graph");
assert.doesNotMatch(androidGradle, /billingclient|stripe/i, "Android still has no billing SDK hookup");

console.log("user experience expansion contract passed");