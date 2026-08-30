import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as moderationPolicy from "../moderation-policy.mjs";
const { REPORT_BUTTON_CLASS, isRoomActive, roomExpiry } = moderationPolicy;
import { formatDisappearsAt } from "../temporary-room-timer-policy.mjs";

const source = await readFile(new URL("../community.js", import.meta.url), "utf8");
const css = await readFile(new URL("../community.css", import.meta.url), "utf8");
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const indexes = JSON.parse(await readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8"));
const directMessageMigration = await readFile(new URL("./direct-message-migration.mjs", import.meta.url), "utf8");

assert.equal(roomExpiry(1_000), 86_401_000);
assert.equal(isRoomActive({ expiresAt: { toMillis: () => 1_001 } }, 1_000), true);
assert.equal(isRoomActive({ expiresAt: { toMillis: () => 1_000 } }, 1_000), false);
assert.equal(formatDisappearsAt({ toMillis: () => Date.UTC(2026, 7, 29, 12, 30) }, "en-US", { timeZone: "UTC" }),
  "Disappears 8/29/2026, 12:30:00 PM");

assert.match(source, /import\s*\{[^}]*createModerationClient[^}]*\}\s*from\s*["']\.\/moderation-client\.mjs["']/s);
assert.match(source, /import\s*\{[^}]*compareNewestFirst[^}]*compareOldestFirst[^}]*\}\s*from\s*["']\.\/content-ordering\.mjs["']/s);
assert.match(source, /expiresAt:\s*Timestamp\.fromMillis\(roomExpiry\(now\(\)\)\)/);
assert.match(source, /moderationState:\s*["']visible["']/);
assert.doesNotMatch(source, /expiresAt:\s*Timestamp\.fromMillis\(now\(\)\s*\+\s*86400000\)/);
assert.match(source, /const activeRoom = \(roomId = state\.activeRoom\) => state\.rooms\.find/);
assert.match(source, /expiresAt:\s*room\.data\(\)\.expiresAt/);
assert.match(source, /expiry\.textContent = formatDisappearsAt\(data\.expiresAt\)/,
  "every temporary-room card shows the exact localized expiry from its lifecycle timestamp");
assert.match(source, /\$\("room-disappears"\)\.textContent = room[\s\S]{0,100}formatDisappearsAt\(room\.data\(\)\.expiresAt\)/,
  "the active-room dialog shows the exact localized expiry from the selected room lifecycle timestamp");
assert.match(await readFile(new URL("../community.html", import.meta.url), "utf8"), /id="room-disappears"[^>]*aria-live="polite"/,
  "the active-room expiry timestamp is exposed as live dialog text");
assert.match(source, /isRoomActive\(room\.data\(\), now\(\)\)/);
assert.match(source, /Room expired/);
assert.match(source, /isBlockedUid\(room\.data\(\)\.ownerId\)/,
  "room interaction checks the live two-direction block snapshot");
assert.equal(REPORT_BUTTON_CLASS, "follow-button report-button");
assert.match(source, /targetKind:\s*["']room["']/);
assert.match(source, /targetPath:\s*`rooms\/\$\{room\.id\}`/);
assert.match(source, /button\.className\s*=\s*REPORT_BUTTON_CLASS/,
  "temporary-room Report buttons reuse the Follow button class token");
assert.doesNotMatch(css, /\.message-report select,\.message-report button\{[^}]*min-height/,
  "room Report buttons are not resized away from the shared Follow pill token");
assert.doesNotMatch(css, /\.message-report select,\.message-report button\{[^}]*flex/,
  "responsive room Report buttons retain the shared Follow pill width");
assert.match(source, /await state\.moderation\.report\(target, reason\.value\);[\s\S]{0,300}state\.rooms = state\.rooms\.filter\(\(entry\) => entry\.id !== room\.id\)[\s\S]{0,250}closeActiveRoom/,
  "a successful room report immediately removes and closes only that room in local UI state");
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
assert.match(rules, /\['roomId', 'senderId', 'tempName', 'text', 'imageData', 'expiresAt', 'moderationState', 'createdAt'\]/);
assert.match(source, /Photo sent in this temporary room[\s\S]{0,100}item\.append\(photo\)/,
  "temporary-room photos remain visible for the room lifetime");
assert.doesNotMatch(source, /Photo sent in this temporary room[\s\S]{0,160}consumeViewedPhoto/,
  "temporary-room photos are not view-once");
assert.match(source, /viewPhoto\.textContent = "View photo once"[\s\S]{0,260}revealedPrivatePhotos\.set\(message\.id, data\.imageData\)[\s\S]{0,160}consumeViewedPhoto\(message\)/,
  "a recipient deliberately opens a private photo before it is consumed");
assert.match(source, /const imageData = data\.senderId === state\.user\.uid \? data\.imageData : revealedImage/,
  "an opened photo remains visible from session memory after its stored copy is consumed");
assert.doesNotMatch(source, /photo\.addEventListener\("load", \(\) => consumeViewedPhoto/,
  "private photos are never consumed merely because the browser preloaded them");
assert.match(source, /legacyReference = doc\(db, "directMessages", message\.id\)[\s\S]{0,300}batch\.delete\(message\.ref\)[\s\S]{0,120}batch\.delete\(legacyReference\)/,
  "individual private-message deletion removes both current and legacy copies");
assert.match(source, /collection\(db, "directMessages"\)[\s\S]{0,900}await deleteDoc\(acceptedRequest\.ref\)/,
  "deleting a chat removes legacy messages before deleting the accepted conversation");
assert.match(directMessageMigration, /batch\.set\([\s\S]{0,180}batch\.delete\(message\.ref\)/,
  "the deployment migration atomically moves legacy messages instead of leaving resurrection copies");
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
  { fieldPath: "roomId", order: "ASCENDING" },
  { fieldPath: "moderationState", order: "ASCENDING" },
  { fieldPath: "createdAt", order: "ASCENDING" },
  { fieldPath: "__name__", order: "ASCENDING" }
]), true, "bounded per-room visible-message queries have a compatible index");

console.log("Community temporary-room lifecycle contract passed");
