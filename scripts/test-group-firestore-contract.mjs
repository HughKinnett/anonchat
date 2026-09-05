import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../group-firestore.mjs", import.meta.url), "utf8");

for (const name of [
  "listPublicGroups",
  "getGroup",
  "createPublicGroup",
  "joinPublicGroup",
  "leaveGroup",
  "listGroupMembers",
  "setGroupModerator",
  "removeGroupMember",
  "listGroupPosts",
  "setGroupPostPinned"
]) assert.match(source, new RegExp(`export\\s+const\\s+${name}\\b`), `exports ${name}`);

assert.match(source, /collection\(db,\s*["']groups["']\)/, "Group records use the groups collection");
assert.match(source, /doc\([^\n]*["']members["']/, "Group membership uses the members subcollection");
assert.match(source, /writeBatch\(db\)/, "public Group creation atomically creates group and owner membership");
assert.match(source, /role:\s*["']owner["']/, "public Group creation creates owner membership");
assert.match(source, /visibility:\s*["']public["']/, "this adapter creates public Groups only");
assert.match(source, /premiumRequired:\s*false/, "public Groups do not require Premium");
assert.match(source, /runTransaction\(db/, "membership and role mutations use transactions");
assert.match(source, /canSelfJoinGroup/, "public self-join is governed by shared Group policy");
assert.match(source, /role\s*===\s*["']owner["']|canManageGroup/, "owner role is protected");
assert.match(source, /collection\(db,\s*["']communityPosts["']\)/, "Group discussions reuse the canonical communityPosts collection");
assert.match(source, /groupId/, "canonical Group posts are scoped by groupId");
assert.doesNotMatch(source, /collection\(db,\s*["']groupPosts["']\)/, "adapter never creates a parallel groupPosts collection");
assert.doesNotMatch(source, /isAdmin|adminUid|globalAdmin/, "Group adapter does not grant or depend on global admin mutation rights");
assert.match(source, /pinnedAt:\s*pinned\s*\?\s*serverTimestamp\(\)/, "pinning updates canonical posts with server time");
assert.match(source, /pinnedBy:/, "pinning records the Group moderator responsible");

console.log("group firestore contract tests passed");
