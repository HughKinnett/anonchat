import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  blockControlState,
  createBlockPairLoadGate,
  createBlockPairTracker,
  filterAccessibleDirectMessages,
  isBlockedPair,
  loadBlockPairs,
  profileBlockViewState
} from "../block-integration.mjs";

assert.equal(isBlockedPair("a", "b", new Set(["a_b"])), true);
assert.equal(isBlockedPair("a", "b", new Set(["b_a"])), true);
assert.equal(isBlockedPair("a", "c", new Set(["a_b"])), false);

const blockChanges = [];
const blockErrors = [];
const tracker = createBlockPairTracker({
  onChange: (pairs) => blockChanges.push(pairs),
  onError: (error) => blockErrors.push(error)
});
tracker.receiveCreated({ docs: [{ id: "viewer_blocked" }] });
assert.equal(tracker.initialized, false);
assert.equal(blockChanges.length, 0);
tracker.reportError(new Error("blockedId query failed"));
assert.equal(blockErrors.length, 1);
assert.equal(blockChanges.length, 0);
tracker.receiveTargeted({ docs: [{ id: "other_viewer" }] });
assert.equal(tracker.initialized, true);
assert.deepEqual([...blockChanges.at(-1)].sort(), ["other_viewer", "viewer_blocked"]);
tracker.reportError(new Error("later listener failure"));
assert.equal(blockChanges.length, 1);
assert.deepEqual([...tracker.pairs].sort(), ["other_viewer", "viewer_blocked"]);

const loaderEvents = [];
const loaderErrors = [];
const listeners = [];
let stoppedListeners = 0;
const failureGate = createBlockPairLoadGate();
const unsubscribeBlocks = await loadBlockPairs({
  db: {},
  uid: "viewer",
  firestore: {
    collection: (_db, path) => ({ path }),
    where: (...parts) => parts,
    query: (...parts) => parts,
    onSnapshot: (reference, onNext, onError) => {
      listeners.push({ reference, onNext, onError });
      return () => { stoppedListeners += 1; };
    }
  },
  onChange: (pairs) => loaderEvents.push(pairs),
  onError: (error) => {
    loaderErrors.push(error);
    failureGate.fail(error);
  }
});
assert.equal(listeners.length, 2);
listeners[0].onNext({ docs: [{ id: "viewer_blocked" }] });
listeners[1].onError(new Error("blockedId query failed"));
assert.equal(loaderEvents.length, 0);
assert.equal(loaderErrors.length, 1);
const failedLoad = await failureGate.ready;
assert.equal(failedLoad.initialized, false);
assert.equal(failedLoad.error.message, "blockedId query failed");
listeners[1].onNext({ docs: [{ id: "other_viewer" }] });
assert.deepEqual([...loaderEvents.at(-1)].sort(), ["other_viewer", "viewer_blocked"]);
listeners[0].onError(new Error("later blockerId query failed"));
assert.equal(loaderEvents.length, 1);
unsubscribeBlocks();
assert.equal(stoppedListeners, 2);

assert.deepEqual(blockControlState({ currentUid: "viewer", targetUid: "target", pairs: new Set() }), {
  visible: true, ownBlock: false, label: "Block User"
});
assert.deepEqual(blockControlState({ currentUid: "viewer", targetUid: "target", pairs: new Set(["target_viewer"]) }), {
  visible: true, ownBlock: false, label: "Block User"
});
assert.deepEqual(blockControlState({ currentUid: "viewer", targetUid: "target", pairs: new Set(["viewer_target"]) }), {
  visible: true, ownBlock: true, label: "Unblock User"
});
assert.equal(blockControlState({ currentUid: "viewer", targetUid: "viewer", pairs: new Set() }).visible, false);

const failedProfileState = profileBlockViewState({
  initialized: false,
  error: new Error("block listener failed"),
  currentUid: "viewer",
  targetUid: "target",
  pairs: new Set()
});
assert.deepEqual(failedProfileState, {
  settled: true,
  initialized: false,
  contentVisible: false,
  status: "This profile is unavailable because block settings could not load.",
  control: { visible: true, ownBlock: false, label: "Block User" }
});

const failedProfileOwnBlock = profileBlockViewState({
  initialized: false,
  error: new Error("block import failed"),
  currentUid: "viewer",
  targetUid: "target",
  pairs: new Set(["viewer_target"])
});
assert.equal(failedProfileOwnBlock.contentVisible, false);
assert.deepEqual(failedProfileOwnBlock.control, { visible: true, ownBlock: true, label: "Unblock User" });

const directMessages = [
  { data: () => ({ participants: ["viewer", "safe"], text: "keep" }) },
  { data: () => ({ participants: ["viewer", "blocked"], text: "hide" }) }
];
assert.deepEqual(
  filterAccessibleDirectMessages(directMessages, new Set(["blocked_viewer"]), true).map((message) => message.data().text),
  ["keep"]
);
assert.deepEqual(filterAccessibleDirectMessages(directMessages, new Set(), false), []);

const [profileHtml, profile, timeline, community] = await Promise.all([
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../profile.js", import.meta.url), "utf8"),
  readFile(new URL("../timeline.js", import.meta.url), "utf8"),
  readFile(new URL("../community.js", import.meta.url), "utf8")
]);

assert.match(profileHtml, /id="profile-block-button"/);
assert.match(profile, /loadBlockPairs\s*\(\s*\{\s*db\s*,\s*uid:\s*user\.uid/);
assert.match(profile, /blockId\s*\(\s*currentUser\.uid\s*,\s*targetUserId\s*\)/);
assert.match(profile, /createBlockPairLoadGate/);
assert.match(profile, /blockPairLoadGate\.fail\(error\)/);
assert.match(profile, /profileBlockViewState/);
assert.match(profile, /const postIsVisibleByBlock\s*=/);
assert.match(profile, /\.filter\(postIsVisibleByBlock\)/);
assert.match(profile, /if \(!commentText \|\| targetIsBlocked\(\)\) return;/);
assert.match(profile, /const renderPosts = \(\) => \{\s*if \(targetIsBlocked\(\)\) return;/);
assert.match(timeline, /canShowActorContent/);
assert.match(timeline, /loadBlockPairs/);
assert.match(timeline, /isBlockedPair/);
assert.match(timeline, /actorIsVisible/);
assert.match(timeline, /if \(!canInteractWith\(targetUid\)\) return;/);
assert.match(timeline, /reveals:\s*reveals\.filter\(\(reveal\) => actorIsVisible\(reveal\.data\(\)\.fromId\)\)/);
assert.match(community, /canShowActorContent/);
assert.match(community, /loadBlockPairs/);
assert.match(community, /isBlockedPair/);
assert.match(community, /actorIsVisible/);
assert.match(community, /filterAccessibleDirectMessages/);
assert.match(community, /messages:\s*filterAccessibleDirectMessages\(state\.messages, state\.blockPairs, state\.blockPairsInitialized\)/);
assert.match(community, /\$\("send-reveal"\)[\s\S]*?if \(!to \|\| !canInteractWith\(to\)\) return;/);
assert.match(community, /const renderReveals = \(\) => \{\s*const other = \$\("conversation-user"\)\.value;\s*if \(!other \|\| !canInteractWith\(other\)\)/);

console.log("block integration tests passed");
