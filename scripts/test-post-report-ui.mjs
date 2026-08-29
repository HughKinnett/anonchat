import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as moderationPolicy from "../moderation-policy.mjs";

const { postIsVisible, postReportPayloads, reportId } = moderationPolicy;
assert.equal(
  typeof moderationPolicy.communityPostReportPayloads,
  "function",
  "community post reports have a collection-specific policy payload"
);
const { communityPostReportPayloads } = moderationPolicy;

const uiPolicy = await import("../post-report-ui-policy.mjs").catch(() => ({}));
assert.equal(typeof uiPolicy.postExpirySelection, "function", "expiry selection is a real policy decision");
assert.equal(typeof uiPolicy.postExpiryTimestamp, "function", "saved expiry consumes the cached selection");
assert.equal(typeof uiPolicy.createReportSubmissionGate, "function", "report concurrency is policy-controlled");
assert.equal(typeof uiPolicy.postInteractionTarget, "function", "repost interaction targeting is explicit");
assert.equal(typeof uiPolicy.postChildBelongsTo, "function", "post child association is collection-aware policy");
assert.equal(typeof uiPolicy.postReportTarget, "function", "collection-specific report targeting is explicit");
assert.equal(typeof uiPolicy.postImagePresentation, "function", "post images are validated before any network load");

const selectedExpiry = uiPolicy.postExpirySelection("1", 10_000);
assert.equal(selectedExpiry, 3_610_000);
assert.equal(
  uiPolicy.postExpiryTimestamp(selectedExpiry, (millis) => ({ millis })).millis,
  3_610_000,
  "submit uses the exact absolute expiry chosen earlier rather than a later clock read"
);
assert.equal(uiPolicy.postExpirySelection("0", 20_000), null);
assert.equal(uiPolicy.postExpiryTimestamp(null, () => assert.fail("Never must not build a timestamp")), null);

const gate = uiPolicy.createReportSubmissionGate();
const reportA = gate.tryStart({ id: "post-a" });
assert.ok(reportA);
assert.equal(gate.tryStart({ id: "post-b" }), null, "B cannot replace A while A is pending");
assert.equal(gate.finish({ id: "not-a" }), false, "a stale completion cannot clear A");
assert.equal(gate.isBusy(), true);
assert.equal(gate.finish(reportA), true);
const reportB = gate.tryStart({ id: "post-b" });
assert.ok(reportB, "B can start only after A finishes");
assert.equal(gate.finish(reportB), true);

assert.equal(
  uiPolicy.postInteractionTarget({ id: "repost-view", type: "repost", originalPostId: "original" }),
  "repost-view",
  "timeline and profile interactions through a repost target the held visible wrapper"
);
const wrapperThread = { id: "repost-view", collectionName: "posts" };
assert.equal(uiPolicy.postChildBelongsTo(wrapperThread, {
  postId: "repost-view",
  collectionName: "posts"
}), true);
assert.equal(uiPolicy.postChildBelongsTo(wrapperThread, {
  postId: "repost-view",
  collectionName: "communityPosts"
}), false, "same-ID comments in a different collection cannot join the visible wrapper thread");
assert.equal(uiPolicy.postChildBelongsTo(wrapperThread, {
  postId: "original",
  collectionName: "posts"
}), false, "original-post comments cannot join a repost wrapper thread");
assert.deepEqual(uiPolicy.postReportTarget({
  id: "community-1",
  collectionName: "communityPosts",
  post: { authorId: "author-1" }
}), {
  id: "community-1",
  collectionName: "communityPosts",
  targetType: "communityPost",
  targetKey: "communityPost",
  authorId: "author-1"
});
assert.deepEqual(uiPolicy.postReportTarget({
  id: "repost-view",
  collectionName: "posts",
  post: { type: "repost", authorId: "reposter", originalPostId: "original" }
}), {
  id: "repost-view",
  collectionName: "posts",
  targetType: "post",
  targetKey: "post",
  authorId: "reposter"
}, "the report hold and interaction writes share the visible repost target");

assert.deepEqual(uiPolicy.postImagePresentation("data:image/jpeg;base64,/9j/AA==", "Photo attached"), {
  kind: "image",
  src: "data:image/jpeg;base64,/9j/AA==",
  alt: "Photo attached",
  referrerPolicy: "no-referrer"
});
for (const unsafe of [
  "https://tracking.example/post.png",
  "javascript:alert(1)",
  "data:image/svg+xml;base64,PHN2Zz4=",
  "data:image/png;base64,iVBORw0KGgo=",
  "data:image/jpeg;base64,not base64"
]) {
  assert.deepEqual(uiPolicy.postImagePresentation(unsafe, "Photo attached"), {
    kind: "placeholder", text: "Image unavailable"
  }, `unsafe legacy image ${unsafe} cannot initiate a load`);
}
assert.deepEqual(uiPolicy.postImagePresentation("", "Photo attached"), { kind: "none" });

const timestamp = { kind: "trusted-server-time" };
const payloads = postReportPayloads({
  postId: "post-1",
  reporterId: "reporter-1",
  authorId: "author-1",
  reason: "Threats",
  timestamp
});

assert.equal(reportId("post", "post-1", "reporter-1"), "post_post-1_reporter-1");
assert.deepEqual(payloads, {
  report: {
    targetType: "post",
    targetId: "post-1",
    reporterId: "reporter-1",
    reportedUserId: "author-1",
    reason: "Threats",
    status: "pending",
    createdAt: timestamp
  },
  post: {
    moderationStatus: "reported",
    reportedAt: timestamp
  }
});
assert.deepEqual(communityPostReportPayloads({
  communityPostId: "community-1",
  reporterId: "reporter-1",
  authorId: "author-1",
  reason: "Spam",
  timestamp
}), {
  report: {
    targetType: "communityPost",
    targetId: "community-1",
    reporterId: "reporter-1",
    reportedUserId: "author-1",
    reason: "Spam",
    status: "pending",
    createdAt: timestamp
  },
  communityPost: {
    moderationStatus: "reported",
    reportedAt: timestamp
  }
});
assert.equal(postIsVisible({ moderationStatus: "reported" }, Date.now()), false);
assert.equal(postIsVisible({ moderationStatus: "active" }, Date.now()), true);

const [timelineHtml, timelineSource, profileSource, timelineCss, indexSource] = await Promise.all([
  readFile(new URL("../timeline.html", import.meta.url), "utf8"),
  readFile(new URL("../timeline.js", import.meta.url), "utf8"),
  readFile(new URL("../profile.js", import.meta.url), "utf8"),
  readFile(new URL("../timeline.css", import.meta.url), "utf8"),
  readFile(new URL("../firestore.indexes.json", import.meta.url), "utf8")
]);

assert.match(timelineHtml, /id="post-report-dialog"/);
assert.match(timelineHtml, /Spam[\s\S]*Harassment[\s\S]*Threats[\s\S]*Sexual content[\s\S]*Other/);
assert.match(timelineHtml, /id="post-expiry-preview"/);
assert.match(timelineHtml, /id="post-image-button"[^>]*class="photo-upload-button compact-photo-button"[^>]*aria-label="Add a photo"/);
assert.match(timelineHtml, /id="post-image-upload"[^>]*class="visually-hidden-file-input"/);
assert.doesNotMatch(timelineHtml, /id="post-image-upload"[^>]*\shidden(?:\s|>)/);
assert.match(timelineHtml, /class="report-hold-copy"[^>]*>[^<]*paused for admin review/);

assert.match(timelineSource, /reportId[\s\S]*postReportPayloads[\s\S]*postIsVisible/);
assert.match(timelineSource, /writeBatch\(db\)/);
assert.match(timelineSource, /batch\.set\([\s\S]*batch\.update\([\s\S]*batch\.commit\(\)/);
assert.match(timelineSource, /locallyReportedPostIds\.add\([\s\S]*renderFeed\(\)[\s\S]*batch\.commit\(\)/);
assert.match(timelineSource, /canInteractWithPost/);
assert.match(timelineSource, /communityPostReportPayloads/);
assert.match(timelineSource, /postReportTarget/);
assert.match(timelineSource, /postInteractionTarget/);
assert.match(timelineSource, /postExpirySelection/);
assert.match(timelineSource, /postExpiryTimestamp/);
assert.match(timelineSource, /postImagePresentation/);
assert.match(timelineSource, /voteDocumentPlan/);
assert.match(timelineSource, /voteBelongsToTarget/);
assert.match(timelineSource, /referrerPolicy\s*=\s*imagePresentation\.referrerPolicy/);
assert.match(timelineSource, /imagePresentation\.kind\s*===\s*"placeholder"/);
assert.doesNotMatch(timelineSource, /postImage\.src\s*=\s*post\.imageData/,
  "legacy imageData is never assigned to an image before validation");
assert.doesNotMatch(timelineSource, /doc\(db, "communityVotes", `\$\{interactionPostId\}_\$\{currentUser\.uid\}`\)/,
  "new votes use the collection-discriminated deterministic ID");
assert.match(timelineSource, /reportSubmissionGate/);
assert.match(timelineSource, /if \(post\.authorId !== currentUser\.uid\)[\s\S]*?openPostReportDialog\(postDoc, report\)/);
assert.match(timelineSource, /batch\.update\(doc\(db, target\.collectionName, target\.id\)/);
assert.match(timelineSource, /collection\(db, sourceCollection, interactionPostId, "comments"\)/);
assert.match(timelineSource, /doc\(db, collectionName, postId, "reactions"/);
assert.match(timelineSource, /collection\(db, "communityPosts"\)[\s\S]*?where\("moderationStatus", "==", "active"\)/);
assert.match(timelineSource, /moderationStatus:\s*"active"/);
assert.match(timelineSource, /where\("moderationStatus",\s*"==",\s*"active"\)/);
assert.match(timelineSource, /postExpiry\.addEventListener\("change"/);

assert.match(profileSource, /postIsVisible/);
assert.match(profileSource, /postInteractionTarget/);
assert.match(profileSource, /postChildBelongsTo/);
assert.match(profileSource, /postImagePresentation/);
assert.match(profileSource, /referrerPolicy\s*=\s*imagePresentation\.referrerPolicy/);
assert.match(profileSource, /imagePresentation\.kind\s*===\s*"placeholder"/);
assert.doesNotMatch(profileSource, /postImage\.src\s*=\s*post\.imageData/,
  "profile legacy imageData is never assigned before validation");
assert.match(profileSource, /\.filter\(\(post\) => postIsVisible\(post\.data\(\), Date\.now\(\)\)\)/);
assert.match(profileSource, /where\("moderationStatus",\s*"==",\s*"active"\)/);
assert.match(profileSource, /Disappears \$\{new Date\(expiresAt\)\.toLocaleString\(\)\}/);
assert.match(profileSource, /postInteractionTarget\(\{ \.\.\.post, id: postDoc\.id \}\)/);
assert.match(profileSource, /postComments\(sourceCollection, interactionPostId\)/);
assert.match(profileSource, /postChildBelongsTo\(/);
assert.match(profileSource, /collection\(db, sourceCollection, interactionPostId, "comments"\)/);
assert.doesNotMatch(profileSource, /const sourceId = post\.type === "repost" \? post\.originalPostId/);

assert.match(timelineCss, /\.compact-photo-button/);
assert.match(timelineCss, /\.post-expiry-preview/);
assert.match(timelineCss, /\.report-button/);
assert.match(timelineCss, /\.compact-photo-button:focus-visible/);
assert.match(timelineCss, /\.visually-hidden-file-input/);

const indexes = JSON.parse(indexSource).indexes;
for (const collectionGroup of ["posts", "communityPosts"]) {
  assert.ok(indexes.some((index) => index.collectionGroup === collectionGroup
    && index.fields.some((field) => field.fieldPath === "moderationStatus")
    && index.fields.some((field) => field.fieldPath === "createdAt")), `${collectionGroup} timeline query is indexed`);
  assert.ok(indexes.some((index) => index.collectionGroup === collectionGroup
    && index.fields.some((field) => field.fieldPath === "authorId")
    && index.fields.some((field) => field.fieldPath === "moderationStatus")), `${collectionGroup} profile query is indexed`);
}

console.log("post report UI tests passed");
