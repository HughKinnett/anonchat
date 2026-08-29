import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { blockedProfileStatus, commentsForPost } from "../profile-render-policy.mjs";

const record = (path, createdAt = 1) => ({
  ref: { path, parent: { id: path.split("/")[0], parent: { path: path.split("/").slice(0, -2).join("/") } } },
  data: () => ({ createdAt })
});
const repost = { ...record("posts/repost-id"), data: () => ({ type: "repost", originalPostId: "original-id" }) };
const communityWithSameId = record("communityPosts/repost-id");
const postComment = record("posts/repost-id/comments/post-comment", 2);
const communityComment = record("communityPosts/repost-id/comments/community-comment", 3);
const originalComment = record("posts/original-id/comments/original-comment", 4);

assert.deepEqual(commentsForPost([communityComment, originalComment, postComment], repost), [originalComment]);
assert.deepEqual(commentsForPost([postComment, originalComment, communityComment], communityWithSameId), [communityComment]);
assert.equal(
  blockedProfileStatus(),
  "You blocked this user. Follow and private contact are unavailable, and their posts are hidden."
);
const profileSource = await readFile(new URL("../profile.js", import.meta.url), "utf8");
assert.equal((profileSource.match(/where\("moderationState", "==", "visible"\)/g) || []).length, 2);
assert.equal(profileSource.includes('where("moderationState", "!=", "hidden")'), false);
assert.equal(profileSource.includes("interactionParentForPost(postDoc)"), true);
assert.equal(profileSource.includes("const parent = interactionParentForPost(postDoc);"), true);
assert.equal(profileSource.includes('addDoc(collection(db, parent.collection, parent.id, "comments"), {'), true);
assert.match(profileSource, /window\.confirm\("Permanently delete this post\? This cannot be undone\."\)/,
  "profile owner deletion requires explicit permanent confirmation");
assert.match(profileSource, /cachedReported\(/, "Profile uses cached report state while rerendering controls");
assert.match(profileSource, /loadReportedState\(/, "Profile loads duplicate report state for user and post controls");
assert.match(profileSource, /watchReported\(/, "Profile passively observes deterministic report receipts across tabs");
assert.match(profileSource, /moderationClient\?\.destroy\(\)/, "Profile tears down report receipt listeners");
assert.match(profileSource, /stopProfileResources/, "Profile auth and terminal page cleanup share one teardown path");
assert.match(profileSource, /pagehide[\s\S]*event\.persisted[\s\S]*stopProfileResources/, "Profile preserves its moderation client in the back-forward cache");
assert.match(profileSource, /pageshow[\s\S]*event\.persisted[\s\S]*invalidateNegative/, "Profile explicitly refreshes bounded negative state after BFCache resume");
assert.match(profileSource, /reportStateWatches\.clear\(\)[\s\S]*reportStateLoads\.clear\(\)/, "Profile teardown clears watcher bookkeeping");
assert.match(profileSource, /if \(!user\)[\s\S]*stopProfileResources\(\)[\s\S]*exitAfterAuthLoss/, "Profile auth loss tears down moderation resources before redirect");
assert.equal((profileSource.match(/limit\(PROFILE_FEED_LIMIT\)/g) || []).length, 2, "both Profile feeds have a hard listener bound");
assert.match(profileSource, /const PROFILE_FEED_LIMIT = 50/, "Profile's per-feed cap is explicit and small");
assert.match(profileSource, /schedulePostsRender/, "receipt and comment callbacks coalesce Profile rerenders");
assert.match(profileSource, /syncProfilePostResources/, "Profile differentially tears down resources that leave the bounded feeds");
assert.doesNotMatch(profileSource, /onSnapshot\(reportRef/, "Profile does not create a Firestore listener per report target");
assert.doesNotMatch(profileSource, /reportButton\.disabled = false;/, "profile rerenders cannot blindly re-enable a duplicate user report");
console.log("Profile render policy passed");
