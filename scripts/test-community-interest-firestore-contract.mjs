import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../community-interest-firestore.mjs", import.meta.url), "utf8");

for (const name of [
  "listCommunities",
  "getCommunity",
  "createPublicCommunity",
  "joinCommunity",
  "leaveCommunity",
  "listCommunityMembers",
  "setCommunityModerator",
  "listCommunityPosts",
  "setCommunityPostPinned"
]) assert.match(source, new RegExp(`export\\s+const\\s+${name}\\b`), `exports ${name}`);

assert.match(source, /collection\(db,\s*["']communities["']\)/, "Community records use a dedicated communities collection");
assert.match(source, /doc\([^\n]*["']members["']/, "Community membership uses the members subcollection");
assert.match(source, /writeBatch\(db\)/, "Community creation uses a batch");
assert.match(source, /role:\s*["']owner["']/, "Community creation atomically creates owner membership");
assert.match(source, /visibility:\s*["']public["']/, "Community creation is public-only in this phase");
assert.match(source, /runTransaction\(db/, "membership/role changes use transactions for idempotence and role preservation");
assert.match(source, /role\s*===\s*["']owner["']|canManageCommunity/, "owner role is protected from self-leave or moderator-only management");
assert.match(source, /collection\(db,\s*["']communityPosts["']\)/, "Community post listing reuses canonical communityPosts");
assert.doesNotMatch(source, /collection\(db,\s*["']interestCommunityPosts["']\)/, "adapter never creates a parallel Community post collection");
assert.match(source, /communityId/, "canonical Community posts are scoped by communityId");
assert.match(source, /pinnedAt:\s*pinned\s*\?\s*serverTimestamp\(\)/, "pinning updates canonical posts with server time");
assert.match(source, /pinnedBy:/, "pinning records the moderator responsible");

console.log("community interest firestore contract tests passed");
