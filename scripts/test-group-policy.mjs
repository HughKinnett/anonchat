import assert from "node:assert/strict";
import {
  normalizeGroup,
  canManageGroup,
  canModerateGroup,
  canSelfJoinGroup,
  sortGroupPosts
} from "../group-policy.mjs";

const publicGroup = normalizeGroup({
  name: "  Local Music Fans  ",
  description: "x".repeat(700),
  topic: "Live Music",
  visibility: "public",
  premiumRequired: true,
  status: "active"
});
assert.equal(publicGroup.name, "Local Music Fans");
assert.equal(publicGroup.slug, "local-music-fans");
assert.equal(publicGroup.description.length, 500);
assert.equal(publicGroup.topic, "Live Music");
assert.equal(publicGroup.visibility, "public");
assert.equal(publicGroup.premiumRequired, false, "public groups stay free");
assert.equal(publicGroup.status, "active");

const privateGroup = normalizeGroup({
  name: "Private Circle",
  visibility: "private",
  premiumRequired: false,
  status: "archived"
});
assert.equal(privateGroup.visibility, "private");
assert.equal(privateGroup.premiumRequired, true, "private groups are Premium-owner spaces");
assert.equal(privateGroup.status, "archived");

assert.equal(normalizeGroup({ name: "ab" }).name, "", "short names are rejected");
assert.equal(canManageGroup({ role: "owner" }), true);
assert.equal(canManageGroup({ role: "moderator" }), false);
assert.equal(canModerateGroup({ role: "owner" }), true);
assert.equal(canModerateGroup({ role: "moderator" }), true);
assert.equal(canModerateGroup({ role: "member" }), false);
assert.equal(canSelfJoinGroup(publicGroup), true);
assert.equal(canSelfJoinGroup(privateGroup), false);

const ordered = sortGroupPosts([
  { id: "old", createdAtMs: 10 },
  { id: "new", createdAtMs: 30 },
  { id: "pin-old", createdAtMs: 5, pinnedAtMs: 40 },
  { id: "pin-new", createdAtMs: 20, pinnedAtMs: 50 }
]);
assert.deepEqual(ordered.map((entry) => entry.id), ["pin-new", "pin-old", "new", "old"]);

console.log("persistent group policy tests passed");
