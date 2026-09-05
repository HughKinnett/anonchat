import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const timeline = await readFile(new URL("../timeline.js", import.meta.url), "utf8");
const html = await readFile(new URL("../timeline.html", import.meta.url), "utf8");

assert.match(timeline, /import \{ createModerationClient \} from "\.\/moderation-client\.mjs";/,
  "Timeline uses the shared moderation client for report submissions");
assert.match(timeline, /import \{ REPORT_BUTTON_CLASS, REPORT_REASONS \} from "\.\/moderation-policy\.mjs";/,
  "the shared report dialog is constrained to the policy's allowed reasons");
assert.match(timeline, /import \{ interactionParentForPost \} from "\.\/interaction-parent-policy\.mjs";/,
  "Timeline uses the shared interaction-parent resolver");
assert.match(timeline, /const createReportDialog = \(\) => \{/,
  "Timeline creates one shared accessible report dialog");
assert.match(timeline, /report\.textContent = "Report";/,
  "cards expose a Report action");
assert.match(timeline, /report\.className = REPORT_BUTTON_CLASS/,
  "Timeline Report buttons reuse the Follow button class token");
assert.match(timeline, /if \(post\.authorId === currentUser\.uid\) \{[\s\S]*remove\.textContent = "Delete";/,
  "every owned card exposes a Delete action");
assert.match(timeline, /window\.confirm\("Permanently delete this post\? This cannot be undone\."\)/,
  "owner deletion requires an explicit permanent confirmation");
assert.match(timeline, /reportCardStatuses\.set\(target\.path, \{ message: "Report submitted\.", isError: false, hidden: true \}\)/,
  "report success immediately marks only the originating card unavailable");
assert.match(timeline, /filter\(\(post\) => reportCardStatuses\.get\(post\.ref\.path\)\?\.hidden !== true\)/,
  "a locally committed report removes that item and all of its interaction controls before the query listener catches up");
assert.match(timeline, /reportCardStatuses\.set\(target\.path, \{ message: "Could not submit this report\. Please try again\.", isError: true \}\)/,
  "report failures are rendered inline on the originating card");
assert.match(timeline, /if \(reportSubmitting \|\| !activeReportTarget\) return;/,
  "the shared dialog prevents duplicate report submissions");
assert.match(timeline, /postReactions = \(postDoc\) => \{[\s\S]*interactionParentForPost\(postDoc\)[\s\S]*reaction\.ref\.parent\.parent\?\.path === parent\.path/,
  "reaction reads use the canonical interaction parent path");
assert.match(timeline, /postComments = \(postDoc\) => \{[\s\S]*interactionParentForPost\(postDoc\)[\s\S]*comment\.ref\.parent\.parent\?\.path === parent\.path[\s\S]*\.sort\(compareOldestFirst\)/,
  "comment reads use the canonical interaction parent path and shared oldest-first comparator");
assert.match(timeline, /const parent = interactionParentForPost\(postDoc\);[\s\S]*toggleReaction\(parent, type\)/,
  "reaction writes use the canonical interaction parent");
assert.match(timeline, /runTransaction\(db,[\s\S]*transaction[.]get\(reactionRef\)[\s\S]*transaction[.]delete\(reactionRef\)[\s\S]*transaction[.]set\(reactionRef/,
  "reaction toggling atomically uses the viewer's current stored reaction");
assert.match(timeline, /addDoc\(collection\(db, parent\.collection, parent\.id, "comments"\), \{/,
  "comment writes use the canonical interaction parent");
assert.match(timeline, /\.sort\(compareNewestFirst\)/,
  "feed ordering uses the shared newest-first comparator");
assert.doesNotMatch(timeline, /\.sort\(\(a, b\) => \(b\.data\(\)\.createdAt\?\.toMillis\?\.\(\) \|\| 0\)/,
  "Timeline has no timestamp-only newest-first content sort");
assert.doesNotMatch(timeline, /\.sort\(\(a, b\) =>/,
  "Timeline has no ad-hoc timestamp sort");
for (const collectionName of ["posts", "communityPosts"]) {
  assert.match(timeline,
    new RegExp(`query\\(collection\\(db, "${collectionName}"\\), where\\("moderationState", "==", "visible"\\), orderBy\\("createdAt", "desc"\\), limit\\(TIMELINE_POST_LIMIT\\)\\)`),
    `${collectionName} query can only receive visible content`
  );
}
assert.match(timeline,
  /visiblePollTargets\(\)[\s\S]*where\("postCollection", "==", postCollection\)[\s\S]*where\("postId", "in", chunk\)/,
  "poll-vote listeners constrain every query to the exact visible post collection and IDs"
);
assert.match(timeline,
  /voteDocumentId\(voteParent\.collection, voteParent\.id, currentUser\.uid\)/,
  "poll vote writes use a collection-namespaced deterministic document ID"
);
assert.match(timeline,
  /postCollection: voteParent\.collection, postId: voteParent\.id/,
  "poll vote writes persist the canonical post collection discriminator"
);
assert.match(timeline,
  /vote\.data\(\)\.postCollection === voteParent\.collection[\s\S]*vote\.data\(\)\.postId === voteParent\.id/,
  "poll results cannot leak between posts and communityPosts documents that share an ID"
);
assert.doesNotMatch(timeline,
  /onSnapshot\(\s*collection\(db, "communityVotes"\)/,
  "Timeline does not use a collection-wide vote listener that fails when hidden posts retain votes"
);
assert.doesNotMatch(timeline, /collectionGroup\(db, "(?:comments|reactions)"\)/,
  "Timeline never runs a collection-group interaction query that parent visibility rules reject");
assert.match(timeline, /syncInteractionListeners\(\)/,
  "Timeline synchronizes interaction listeners to the visible canonical parent set");
assert.match(timeline, /collection\(db, entry\.parent\.collection, entry\.parent\.id, kind\)/,
  "each interaction listener is scoped beneath an exact visible parent");
assert.match(timeline, /entry\.generation !== interactionGeneration/,
  "stale interaction callbacks are discarded after a visible-set or auth change");
assert.match(timeline, /clearInteractionListeners/,
  "interaction listeners have an explicit lifecycle cleanup");
assert.match(timeline, /limit\(MAX_INTERACTION_ITEMS_PER_PARENT\)/,
  "every parent-scoped interaction query has a hard result limit");
const interactionListenerSource = timeline.match(/const startInteractionChildren = \(entry\) => \{([\s\S]*?)\n\};\n\nconst syncInteractionListeners/)?.[1] || "";
assert.doesNotMatch(interactionListenerSource, /orderBy\("createdAt"/,
  "parent-scoped interaction listeners include legacy records that do not have createdAt");
assert.match(timeline, /collection\(db, entry\.parent\.collection, entry\.parent\.id, kind\),\s*limit\(MAX_INTERACTION_ITEMS_PER_PARENT\)/,
  "parent-scoped interaction listeners remain bounded while including legacy records");
assert.match(timeline, /doc\(db, entry\.parent\.collection, entry\.parent\.id, "reactions", entry\.uid\)/,
  "each bounded parent separately retains the viewer's reaction document");
assert.match(timeline, /boundedInteractionCount\(\s*commentDocs\.length, interactionIsTruncated\(parent\.path, "comments"\)\s*\)/,
  "comment totals explicitly mark a bounded result as truncated");
assert.match(timeline, /const interactionTruncated = reactionsTruncated \|\| interactionIsTruncated\(parent\.path, "comments"\);[\s\S]{0,200}boundedInteractionCount\(interactionCount, interactionTruncated\)/,
  "combined reaction and comment totals explicitly mark bounded results as truncated");
assert.match(timeline, /interactionSummaryLabel\.textContent = `💬 [\s\S]*?\$\{interactionTotal\} interaction/,
  "every rendered post shows an emoji and numeric interaction count immediately");
assert.match(timeline, /reactionsBar\.append\([\s\S]{0,500}reactionButton/,
  "reaction controls remain available while their bounded counter is loading");
assert.match(timeline, /manuallyLoadedInteractionPaths\.add\(parent\.path\);\s*syncInteractionListeners\(\)/,
  "using a reaction keeps its interaction stream attached");
assert.match(timeline, /commentsSection = document\.createElement\("details"\);[\s\S]{0,5000}commentForm\.addEventListener\("submit"/,
  "comments and write controls remain openable even when the current count is zero");
assert.doesNotMatch(timeline, /Comments · Retry/,
  "the normal comment surface never collapses into a retry-only state");
assert.match(timeline, /interactionParentLoadState\(interactionSubscriptions\.get\(record\.ref\.parent\.parent\?\.path\)\) === "bounded"/,
  "partially loaded parent records cannot feed notification state");
assert.match(timeline, /const loadedReactions = fullyLoadedInteractionRecords\(reactions\);[\s\S]{0,200}const loadedComments = fullyLoadedInteractionRecords\(comments\);/,
  "notification rendering rechecks current per-parent load state and cannot use stale removed entries");
assert.match(timeline, /onSnapshot\(\s*doc\(db, parent\.collection, parent\.id\)/,
  "reposts resolve original parents outside the feed query windows");
assert.doesNotMatch(timeline, /const syncInteractionListeners = \(\) => \{\s*clearInteractionListeners\(\)/,
  "unchanged parents are retained rather than torn down on every snapshot");
assert.match(timeline, /where\("blockedUid", "==", user\.uid\)/,
  "Timeline subscribes to blocks created by other users against the viewer");
assert.match(timeline, /if \(!viewerBlocks\.ready\)/,
  "Timeline fails closed until both block directions load");
assert.match(timeline, /const stopTimelineResources = \(\) =>/, "Timeline uses one idempotent listener and moderation teardown path");
assert.match(timeline, /moderationClient\?\.destroy\(\)/, "Timeline destroys its moderation client during terminal cleanup");
assert.match(timeline, /pagehide[\s\S]*event\.persisted[\s\S]*stopTimelineResources/, "Timeline preserves live resources only for BFCache pagehide");
assert.match(timeline, /pageshow[\s\S]*event\.persisted[\s\S]*renderNotifications/, "Timeline restores its expiry timer after BFCache resume");
assert.match(timeline, /if \(!user\)[\s\S]*stopTimelineResources\(\)[\s\S]*exitAfterAuthLoss/, "Timeline auth loss cleans up before redirect");

const composerOptions = html.match(/<div class="composer-options">([\s\S]*?)<\/div>/)?.[1] || "";
assert.match(composerOptions, /id="post-expiry"[\s\S]*label class="photo-bubble" for="post-image-upload" aria-label="Add photo"/,
  "the Add photo control is beside Disappear in composer options");
assert.doesNotMatch(html, /modern-photo-button/,
  "the legacy text photo button is removed");

console.log("Timeline moderation UI contract passed");
