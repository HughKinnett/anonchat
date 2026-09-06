import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { hardenRetiredFeatureRules } from "./retired-feature-rules-hardening.mjs";

const source = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const hardened = hardenRetiredFeatureRules(source);

for (const header of [
  "match /groups/{groupId}",
  "match /groups/{groupId}/members/{userId}",
  "match /groups/{groupId}/privateGroupMessages/{messageId}",
  "match /communities/{communityId}",
  "match /communities/{communityId}/members/{userId}",
  "match /communities/{communityId}/badges/{badgeId}",
  "match /communities/{communityId}/members/{userId}/badges/{badgeId}"
]) {
  const start = hardened.indexOf(header);
  assert.notEqual(start, -1, `${header} remains explicitly covered`);
  const snippet = hardened.slice(start, start + 180);
  assert.match(snippet, /allow read, write: if false;/, `${header} is deny-all after hardening`);
}

const badgeTypesStart = hardened.indexOf("match /badgeTypes/{badgeId}");
assert.notEqual(badgeTypesStart, -1, "badgeTypes rules remain explicit");
assert.match(hardened.slice(badgeTypesStart, badgeTypesStart + 240), /allow read: if signedIn\(\);[\s\S]*allow create, update, delete: if false;/,
  "badge definitions are client read-only");

const earnedStart = hardened.indexOf("match /users/{userId}/badges/{badgeId}");
assert.notEqual(earnedStart, -1, "earned badge rules remain explicit");
assert.match(hardened.slice(earnedStart, earnedStart + 260), /allow read: if profileBadgesReadable\(userId\);[\s\S]*allow create, update, delete: if false;/,
  "earned badges are immutable from all clients including admins");

assert.match(hardened, /match \/rooms\/\{roomId\}/, "Temporary Rooms rules are preserved");
assert.match(hardened, /match \/premiumAccess\/\{userId\}/, "Premium access rules are preserved");

console.log("Retired feature Firestore rules hardening contract passed");
