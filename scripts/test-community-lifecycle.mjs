import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isRoomActive, roomExpiry } from "../moderation-policy.mjs";

const source = await readFile(new URL("../community.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const indexes = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));

assert.equal(roomExpiry(1_000), 86_401_000);
assert.equal(isRoomActive({ expiresAt: { toMillis: () => 1_001 } }, 1_000), true);
assert.equal(isRoomActive({ expiresAt: { toMillis: () => 1_000 } }, 1_000), false);

assert.match(source, /import\s*\{[^}]*createModerationClient[^}]*\}\s*from\s*["']\.\/moderation-client\.mjs["']/s);
assert.match(source, /import\s*\{[^}]*compareNewestFirst[^}]*compareOldestFirst[^}]*\}\s*from\s*["']\.\/content-ordering\.mjs["']/s);
assert.match(source, /expiresAt:\s*Timestamp\.fromMillis\(roomExpiry\(now\(\)\)\)/);
assert.match(source, /moderationState:\s*["']visible["']/);
assert.doesNotMatch(source, /expiresAt:\s*Timestamp\.fromMillis\(now\(\)\s*\+\s*86400000\)/);
assert.match(source, /const activeRoom = \(roomId = state\.activeRoom\) => state\.rooms\.find/);
assert.match(source, /expiresAt:\s*room\.data\(\)\.expiresAt/);
assert.match(source, /isRoomActive\(room\.data\(\), now\(\)\)/);
assert.match(source, /Room expired/);
assert.match(source, /isBlockedUid\(room\.data\(\)\.ownerId\)/,
  "room interaction checks the live two-direction block snapshot");
assert.match(source, /targetKind:\s*["']roomMessage["']/);
assert.match(source, /targetPath:\s*`roomMessages\/\$\{message\.id\}`/);
assert.match(source, /where\(["']moderationState["'],\s*["']==["'],\s*["']visible["']\)/);
assert.match(source, /orderBy\(documentId\(\)\)/);
assert.match(source, /\.sort\(compareNewestFirst\)/);
assert.match(source, /\.sort\(compareOldestFirst\)/);
assert.match(source, /scheduleExpiryBoundary\(/, "selected rooms use an expiry-boundary timer");
assert.match(source, /pagehide/, "selected-room expiry timer is cleaned up with the page");
assert.match(source, /const stopCommunityResources = \(\) =>/, "Community uses one idempotent listener and moderation teardown path");
assert.match(source, /state\.moderation\?\.destroy\(\)/, "Community destroys its moderation client during terminal cleanup");
assert.match(source, /pagehide[\s\S]*event\.persisted[\s\S]*stopCommunityResources/, "Community preserves live resources only for BFCache pagehide");
assert.match(source, /pageshow[\s\S]*event\.persisted[\s\S]*scheduleActiveRoomExpiry/, "Community restores its expiry timer after BFCache resume");
assert.match(source, /if \(!user\)[\s\S]*stopCommunityResources\(\)[\s\S]*exitAfterAuthLoss/, "Community auth loss cleans up before redirect");
assert.match(source, /acceptedUsers = \(\) => state\.users\.filter\(.*!isBlockedUid\(user\.id\)/s, "blocked users are excluded from accepted conversations");
assert.match(source, /message\.data\(\)\.participants\.includes\(other\)\s*&& !isBlockedUid\(message\.data\(\)\.senderId\)/s, "blocked direct-message bodies are filtered");
assert.match(source, /This conversation is unavailable because of a block\./, "a blocked selected conversation closes with direction-neutral plain language");
assert.match(source, /where\("blockedUid", "==", user\.uid\)/,
  "Community subscribes to blocks created against the viewer");
assert.match(source, /if \(!state\.viewerBlocks\.ready\)/,
  "Community private and public renderers fail closed while block snapshots load");

assert.match(rules, /function roomIsActive\(room\)\s*\{\s*return room\.expiresAt is timestamp/s);
assert.match(rules, /\['name', 'topic', 'ownerId', 'createdAt', 'expiresAt', 'moderationState'\]/);
assert.match(rules, /\['roomId', 'senderId', 'tempName', 'text', 'expiresAt', 'moderationState', 'createdAt'\]/);
assert.match(rules, /request\.resource\.data\.moderationState == 'visible'/);

const hasIndex = (collectionGroup, fields) => indexes.indexes.some((index) =>
  index.collectionGroup === collectionGroup && JSON.stringify(index.fields) === JSON.stringify(fields)
);
assert.equal(hasIndex("rooms", [
  { fieldPath: "moderationState", order: "ASCENDING" },
  { fieldPath: "expiresAt", order: "ASCENDING" },
  { fieldPath: "__name__", order: "ASCENDING" }
]), true, "visible active rooms have a compatible index");
assert.equal(hasIndex("roomMessages", [
  { fieldPath: "moderationState", order: "ASCENDING" },
  { fieldPath: "createdAt", order: "ASCENDING" },
  { fieldPath: "__name__", order: "ASCENDING" }
]), true, "visible room messages have a compatible index");

console.log("Community temporary-room lifecycle contract passed");
