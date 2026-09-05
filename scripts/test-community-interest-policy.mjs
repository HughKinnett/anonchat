import assert from "node:assert/strict";
import {
  canManageCommunity,
  canModerateCommunity,
  normalizeCommunity,
  normalizeCommunityRules,
  sortCommunityPosts
} from "../community-interest-policy.mjs";

const normalized = normalizeCommunity({
  name: "  Local Music Fans  ",
  slug: "Local Music Fans!!",
  description: "  Talk about local shows.  ",
  topic: "Music",
  rules: [" Be respectful ", "No spam"],
  visibility: "private",
  status: "unexpected"
});

assert.equal(normalized.name, "Local Music Fans");
assert.equal(normalized.slug, "local-music-fans");
assert.equal(normalized.description, "Talk about local shows.");
assert.equal(normalized.topic, "music");
assert.equal(normalized.visibility, "public", "this phase supports public Communities only");
assert.equal(normalized.status, "active");
assert.deepEqual(normalized.rules, ["Be respectful", "No spam"]);

assert.equal(normalizeCommunity({ name: "x" }).name, "", "community names shorter than 3 chars are rejected");
assert.equal(normalizeCommunity({ name: "A".repeat(61) }).name.length, 60, "community names are capped at 60 chars");
assert.equal(normalizeCommunity({ description: "D".repeat(600) }).description.length, 500, "community descriptions are capped at 500 chars");
assert.equal(normalizeCommunityRules(Array.from({ length: 12 }, (_, index) => `Rule ${index + 1}`)).length, 10, "only 10 rules are stored");
assert.equal(normalizeCommunityRules(["R".repeat(220)])[0].length, 180, "rules are capped at 180 chars");

assert.equal(canManageCommunity({ role: "owner" }), true);
assert.equal(canManageCommunity({ role: "moderator" }), false);
assert.equal(canManageCommunity({ role: "member" }), false);
assert.equal(canModerateCommunity({ role: "owner" }), true);
assert.equal(canModerateCommunity({ role: "moderator" }), true);
assert.equal(canModerateCommunity({ role: "member" }), false);
assert.equal(canModerateCommunity(null), false);

const posts = [
  { id: "old", pinnedAtMs: 0, createdAtMs: 100 },
  { id: "new", pinnedAtMs: 0, createdAtMs: 300 },
  { id: "pin-old", pinnedAtMs: 400, createdAtMs: 50 },
  { id: "pin-new", pinnedAtMs: 500, createdAtMs: 200 }
];
assert.deepEqual(sortCommunityPosts(posts).map((entry) => entry.id), ["pin-new", "pin-old", "new", "old"], "pinned posts sort first and newest content remains first within each group");

console.log("community interest policy tests passed");
