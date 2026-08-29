import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sources = Object.fromEntries(await Promise.all(
  ["timeline.js", "profile.js", "community.js", "connections.js"].map(async (file) => [
    file, await readFile(new URL(`../${file}`, import.meta.url), "utf8")
  ])
));
const metadataPolicy = await readFile(new URL("../protected-metadata-policy.mjs", import.meta.url), "utf8");
const stopFunctions = {
  "timeline.js": "stopTimelineResources",
  "profile.js": "stopProfileResources",
  "community.js": "stopCommunityResources",
  "connections.js": "stopConnectionsListeners"
};

for (const [file, source] of Object.entries(sources)) {
  assert.match(source, /createViewerBlockTracker/, `${file} uses centralized viewer block filtering`);
  assert.match(source, /where\("blockerUid", "==", (?:(?:user|currentUser)\.uid|uid)\)/,
    `${file} listens to viewer-created blocks`);
  assert.match(source, /where\("blockedUid", "==", (?:(?:user|currentUser)\.uid|uid)\)/,
    `${file} listens to blocks created against the viewer`);
  assert.match(source, /\.ready/, `${file} has a fail-closed block loading state`);
  assert.match(source, /sessionGeneration\.isCurrent/, `${file} rejects queued callbacks from an old auth session`);
  for (const direction of ["outgoing", "incoming"]) {
    assert.match(source, new RegExp(`blockTracker\\.fail\\("${direction}"\\)`),
      `${file} fails closed when its ${direction} block listener terminates`);
  }
  assert.match(source,
    new RegExp(`onAuthStateChanged\\(auth, async \\(user\\) => \\{[\\s\\S]{0,320}${stopFunctions[file]}\\(\\);`),
    `${file} clears the prior session at the start of every auth callback`);
}

assert.match(sources["timeline.js"], /isBlockedPost\(post, viewerBlocks\)/,
  "Timeline hides both blocked repost sharers and blocked original authors");
assert.match(sources["timeline.js"], /visibleRecords\((?:reactions|comments), viewerBlocks, \["uid"\]\)/,
  "Timeline filters blocked comment and reaction actors");
assert.match(sources["timeline.js"], /const matchedUsers = visibleUsers\(\)/,
  "Timeline search hides blocked profiles");
assert.match(sources["profile.js"], /isBlockedPost\(post, viewerBlocks\)/,
  "profile feeds hide reposts whose original author is blocked");
assert.match(sources["profile.js"], /sessionListeners\.push\(onSnapshot\(collection\(db, "users"\)/,
  "Profile retains its users listener for auth-session cleanup");
assert.match(sources["profile.js"], /sessionListeners\.push\(onSnapshot\(collection\(db, "follows"\)/,
  "Profile retains its follows listener for auth-session cleanup");
assert.match(sources["profile.js"], /sessionListeners\.splice\(0\)\.forEach\(\(unsubscribe\) => unsubscribe\(\)\)/,
  "Profile unsubscribes every retained session listener before auth state is replaced");
assert.match(sources["profile.js"], /const clearProtectedProfileMetadata = \(message\) => \{[\s\S]{0,180}clearProfileProtectedMetadata/,
  "Profile delegates every metadata reset to the tested DOM policy");
assert.match(metadataPolicy, /clearProfileProtectedMetadata[\s\S]*profile-followers[\s\S]*removeAttribute\("href"\)[\s\S]*profile-following[\s\S]*profile-admin-link[\s\S]*hidden = true/,
  "the Profile DOM policy clears counts, links, identity, and admin metadata");
assert.match(sources["profile.js"], /if \(!viewerBlocks\.ready\) \{[\s\S]{0,100}clearProtectedProfileMetadata/,
  "a terminal Profile block-listener error clears protected metadata");
assert.match(sources["profile.js"], /const stopProfileResources = \(\) => \{[\s\S]{0,800}clearProtectedProfileMetadata/,
  "an A-admin to B auth transition clears the prior admin metadata immediately");
assert.match(sources["community.js"], /!isBlockedUid\(request\.data\(\)\.fromId\)/,
  "blocked incoming message requests are hidden");
assert.match(sources["connections.js"], /visibleFollows\(\)/,
  "connection counts and cards exclude blocked relationships");
assert.match(sources["connections.js"], /const clearProtectedConnectionsMetadata = \(message\) => \{[\s\S]{0,180}clearConnectionsProtectedMetadata/,
  "Connections delegates every metadata reset to the tested DOM policy");
assert.match(metadataPolicy, /clearConnectionsProtectedMetadata[\s\S]*connections-title[\s\S]*followers-count[\s\S]*following-count/,
  "the Connections DOM policy clears title and counts");
assert.match(sources["connections.js"], /if \(!viewerBlocks\.ready\) \{[\s\S]{0,100}clearProtectedConnectionsMetadata/,
  "a terminal Connections block-listener error clears title and counts");
assert.match(sources["connections.js"], /const stopConnectionsListeners = \(\) => \{[\s\S]{0,400}clearProtectedConnectionsMetadata/,
  "Connections clears prior title/count metadata at auth callback start");

console.log("Viewer block surface contracts passed");
