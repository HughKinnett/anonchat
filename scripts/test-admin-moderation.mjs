import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_MODERATION_BATCH_WRITES,
  deterministicDeletionPages,
  filterPendingReports,
  markReportsResolved,
  moderationActionAllowed,
  moderationDeletionQueuePlan,
  moderationDeletionState,
  moderationResolutionPlan,
  moderationTargetCollection,
  pendingReports,
  reportedPostRows,
  reportedRoomRows,
  resolvedReportsForTarget,
  roomEvidencePage
} from "../admin-dashboard-policy.mjs";

const instant = (milliseconds) => ({ toMillis: () => milliseconds });
const reports = [
  { id: "resolved", targetType: "post", targetId: "old", reporterId: "reporter", reportedUserId: "owner", reason: "Spam", status: "resolved", createdAt: instant(400) },
  { id: "older", targetType: "communityPost", targetId: "community", reporterId: "reporter", reportedUserId: "owner", reason: "Other", status: "pending", createdAt: instant(100) },
  { id: "newest", targetType: "room", targetId: "room", reporterId: "reporter", reportedUserId: "owner", reason: "Harassment", status: "pending", createdAt: instant(300) },
  { id: "same-time-z", targetType: "post", targetId: "timeline", reporterId: "reporter", reportedUserId: "owner", reason: "Spam", status: "pending", createdAt: instant(200) },
  { id: "same-time-a", targetType: "post", targetId: "timeline-2", reporterId: "reporter", reportedUserId: "owner", reason: "Spam", status: "pending", createdAt: instant(200) },
  { id: "unsupported", targetType: "comment", targetId: "comment", reporterId: "reporter", reportedUserId: "owner", reason: "Spam", status: "pending", createdAt: instant(500) },
  { id: "stale-resolved", targetType: "post", targetId: "timeline", reporterId: "older-reporter", reportedUserId: "owner", reason: "Spam", status: "resolved", createdAt: instant(50) }
];

// A missing status check, wrong timestamp direction, or unstable tie-break must fail this assertion.
assert.deepEqual(filterPendingReports(reports).map((report) => report.id), [
  "newest", "same-time-a", "same-time-z", "older"
]);
assert.deepEqual(pendingReports(reports).map((report) => report.id), [
  "newest", "same-time-a", "same-time-z", "older"
]);
const locallyResolved = markReportsResolved(reports, ["newest"]);
assert.equal(locallyResolved.find((report) => report.id === "newest").status, "resolved");
assert.equal(reports.find((report) => report.id === "newest").status, "pending");
assert.deepEqual(resolvedReportsForTarget(reports, reports[3]).map((report) => report.id), ["stale-resolved"]);

assert.equal(moderationActionAllowed({ status: "pending", targetType: "post", action: "restore-post" }), true);
assert.equal(moderationActionAllowed({ status: "pending", action: "restore-post" }), true);
assert.equal(moderationActionAllowed({ status: "resolved", targetType: "post", action: "restore-post" }), false);
assert.equal(moderationActionAllowed({ status: "resolved", action: "restore-post" }), false);
assert.equal(moderationActionAllowed({ status: "pending", targetType: "communityPost", action: "delete-post" }), true);
assert.equal(moderationActionAllowed({ status: "pending", targetType: "room", action: "restore-room" }), true);
assert.equal(moderationActionAllowed({ status: "pending", targetType: "room", action: "restore-post" }), false);
assert.equal(moderationActionAllowed({ status: "pending", targetType: "post", action: "delete-room" }), false);
assert.equal(moderationTargetCollection("post"), "posts");
assert.equal(moderationTargetCollection("communityPost"), "communityPosts");
assert.equal(moderationTargetCollection("room"), "rooms");

const users = [
  { id: "reporter", username: "careful_member" },
  { id: "owner", username: "content_owner" }
];
const postRows = reportedPostRows({
  reports,
  posts: [
    { id: "timeline", authorId: "owner", username: "content_owner", content: "timeline evidence" },
    { id: "timeline-2", authorId: "owner", username: "content_owner", content: "second timeline evidence" }
  ],
  communityPosts: [
    { id: "community", authorId: "owner", username: "content_owner", content: "community evidence", category: "Question" }
  ],
  users
});
assert.deepEqual(postRows.map((row) => row.report.id), ["same-time-a", "same-time-z", "older"]);
assert.equal(postRows[0].targetCollection, "posts");
assert.equal(postRows[0].reporterUsername, "careful_member");
assert.equal(postRows[0].ownerUsername, "content_owner");
assert.equal(postRows[0].preview, "second timeline evidence");
assert.equal(postRows[2].targetCollection, "communityPosts");
assert.equal(postRows[2].preview, "community evidence");

const imageRows = reportedPostRows({
  reports: [{ ...reports[3], targetId: "image-only" }],
  posts: [{ id: "image-only", authorId: "owner", username: "content_owner", content: "", imageData: "data:image/jpeg;base64,/9j/AA==" }],
  users
});
assert.deepEqual(imageRows[0].imagePreview, {
  kind: "image",
  src: "data:image/jpeg;base64,/9j/AA==",
  alt: "Image attached to reported timeline post",
  referrerPolicy: "no-referrer"
});
assert.equal(imageRows[0].preview, "Photo post");
const unsafeImageRows = reportedPostRows({
  reports: [{ ...reports[3], targetId: "unsafe-image" }],
  posts: [{ id: "unsafe-image", authorId: "owner", content: "", imageData: "https://tracking.example/private.png" }],
  users
});
assert.deepEqual(unsafeImageRows[0].imagePreview, {
  kind: "placeholder", text: "Image unavailable"
}, "legacy remote images render a non-loading placeholder");

const roomRows = reportedRoomRows({
  reports,
  rooms: [{ id: "room", ownerId: "owner", name: "Review room", topic: "Preserved topic" }],
  roomEvidenceByRoom: new Map([["room", {
    messages: [
      { id: "later", roomId: "room", tempName: "Guest 2", text: "later evidence", createdAt: instant(20) },
      { id: "earlier", roomId: "room", tempName: "Guest 1", text: "earlier evidence", createdAt: instant(10) }
    ],
    totalCount: 25,
    hasMore: true,
    loading: false,
    error: null
  }]]),
  users
});
assert.equal(roomRows.length, 1);
assert.equal(roomRows[0].preview, "Review room — Preserved topic");
assert.deepEqual(roomRows[0].messages.map((message) => message.text), ["earlier evidence", "later evidence"]);
assert.equal(roomRows[0].evidenceTotalCount, 25);
assert.equal(roomRows[0].evidenceHasMore, true);
assert.equal(roomRows[0].evidenceLoading, false);

const evidence = Array.from({ length: 29 }, (_, index) => ({ id: `message-${index}` }));
assert.deepEqual(roomEvidencePage(evidence, 12), {
  messages: evidence.slice(0, 12), visibleCount: 12, totalCount: 29, hasMore: true, nextVisibleCount: 24
});
assert.deepEqual(roomEvidencePage(evidence, 24), {
  messages: evidence.slice(0, 24), visibleCount: 24, totalCount: 29, hasMore: true, nextVisibleCount: 29
});
assert.deepEqual(roomEvidencePage(evidence, 29), {
  messages: evidence, visibleCount: 29, totalCount: 29, hasMore: false, nextVisibleCount: 29
});

const stamp = Symbol("server timestamp");
const expiry = Symbol("fresh room expiry");
const duplicateTimelineReport = {
  ...reports[3], id: "legacy-duplicate", reporterId: "legacy-reporter", createdAt: instant(150)
};
assert.deepEqual(moderationResolutionPlan({
  report: reports[3], reports: [duplicateTimelineReport, reports[3]],
  action: "restore-post", adminId: "admin", timestamp: stamp
}), {
  markerId: "post_timeline",
  marker: {
    targetType: "post", targetId: "timeline",
    reportIds: ["legacy-duplicate", "same-time-z"], reportCount: 2,
    action: "restore-post", adminId: "admin", actedAt: stamp
  },
  reportResolutions: [
    { id: "legacy-duplicate", data: { status: "resolved", resolvedBy: "admin", resolutionAction: "restore-post", resolvedAt: stamp } },
    { id: "same-time-z", data: { status: "resolved", resolvedBy: "admin", resolutionAction: "restore-post", resolvedAt: stamp } }
  ],
  targetCollection: "posts",
  target: { moderationStatus: "active", reportedAt: null },
  deleteTarget: false
});
const allLocallyResolved = markReportsResolved(reports.concat(duplicateTimelineReport), ["same-time-z", "legacy-duplicate"]);
assert.equal(allLocallyResolved.find((report) => report.id === "same-time-z").status, "resolved");
assert.equal(allLocallyResolved.find((report) => report.id === "legacy-duplicate").status, "resolved");
assert.equal(reports[3].status, "pending", "target-wide local resolution is immutable");
const highVolumeReports = Array.from({ length: 401 }, (_, index) => ({
  ...reports[3], id: `bulk-${String(index).padStart(3, "0")}`, reporterId: `reporter-${index}`
}));
const highVolumeRestore = moderationResolutionPlan({
  report: highVolumeReports[0], reports: highVolumeReports,
  action: "restore-post", adminId: "admin", timestamp: stamp
});
assert.equal(highVolumeRestore.marker.reportCount, 401, "a valid 403-write restore batch is not artificially capped at 400 reports");
assert.equal(highVolumeRestore.reportResolutions.length, 401);
assert.deepEqual(moderationResolutionPlan({
  report: reports[1], reports: [reports[1]], action: "delete-post", adminId: "admin", timestamp: stamp
}), {
  markerId: "communityPost_community",
  marker: {
    targetType: "communityPost", targetId: "community", reportIds: ["older"], reportCount: 1,
    action: "delete-post", adminId: "admin", actedAt: stamp
  },
  reportResolutions: [{ id: "older", data: {
    status: "resolved", resolvedBy: "admin", resolutionAction: "delete-post", resolvedAt: stamp
  } }],
  targetCollection: "communityPosts",
  target: null,
  deleteTarget: true
});
assert.deepEqual(moderationResolutionPlan({
  report: reports[2], reports: [reports[2]], action: "restore-room", adminId: "admin", timestamp: stamp, expiresAt: expiry
}).target, {
  moderationStatus: "active", reportedAt: null, resumedAt: stamp, expiresAt: expiry
});
assert.throws(() => moderationResolutionPlan({
  report: reports[2], action: "restore-room", adminId: "admin", timestamp: stamp
}), /expiry/i);
assert.throws(() => moderationResolutionPlan({
  report: reports[2], action: "restore-post", adminId: "admin", timestamp: stamp
}), /not allowed/i);

assert.deepEqual(moderationDeletionQueuePlan({
  report: reports[1], adminId: "admin", timestamp: stamp
}), {
  jobId: "communityPost_community",
  job: {
    targetType: "communityPost",
    targetId: "community",
    reportId: "older",
    requesterUid: "admin",
    requestedAt: stamp,
    status: "queued"
  }
});
assert.throws(() => moderationDeletionQueuePlan({
  report: { ...reports[1], status: "resolved" }, adminId: "admin", timestamp: stamp
}), /pending/i);
const moderationJobs = new Map([
  ["post_timeline", { data: { status: "queued" } }],
  ["room_room", { data: { status: "failed" } }],
  ["communityPost_community", { data: { status: "completed" } }]
]);
assert.deepEqual(moderationDeletionState(moderationJobs, reports[3]), {
  pending: true, failed: false, label: "Deletion Pending"
});
assert.deepEqual(moderationDeletionState(moderationJobs, reports[2]), {
  pending: true, failed: true, label: "Deletion Pending — retry scheduled"
});
assert.deepEqual(moderationDeletionState(moderationJobs, reports[1]), {
  pending: true,
  failed: false,
  completed: true,
  label: "Deletion completed — this content ID is permanently retired"
}, "a completed barrier never re-enables restore or destructive controls");
assert.equal(moderationActionAllowed({
  status: "pending", targetType: "post", action: "restore-post",
  blocked: moderationDeletionState(moderationJobs, reports[3])?.pending
}), false, "a queued deletion disables concurrent restore");

assert.equal(MAX_MODERATION_BATCH_WRITES, 400);
const deletionPages = deterministicDeletionPages([
  { path: "z/3" }, { path: "a/2" }, { path: "a/1" }, { path: "m/4" }, { path: "q/5" }
], 2);
assert.deepEqual(deletionPages.map((page) => page.map((record) => record.path)), [
  ["a/1", "a/2"], ["m/4", "q/5"], ["z/3"]
]);
assert.throws(() => deterministicDeletionPages([], 401), /400/);

const [html, source] = await Promise.all([
  readFile(new URL("../admin.html", import.meta.url), "utf8"),
  readFile(new URL("../admin.js", import.meta.url), "utf8")
]);
assert.match(html, /Reported Content/);
assert.match(html, /id="reported-count"/);
assert.match(html, /data-report-filter="post"[^>]*>Post</);
assert.match(html, /data-report-filter="room"[^>]*>Temporary Room</);
assert.match(html, /Restore to Timeline/);
assert.match(html, /Allow Room to Resume/);
assert.match(html, /Permanently Delete Post/);
assert.match(html, /Permanently Delete Room/);
assert.match(html, /Moderation deletion service/);
assert.match(html, /id="moderation-processor-health"/);
assert.match(html, /process-admin-deletions\.yml[^>]*>Open moderation recovery page/);
assert.ok(html.indexOf("Reported Content") < html.indexOf("Manage Users"));
assert.match(source, /Timestamp\.fromMillis\(Date\.now\(\) \+ 86_400_000\)/);
assert.match(source, /collection\(db, "reports"\)/);
assert.match(source, /collection\(db, "moderationActions"\)/);
assert.match(source, /collection\(db, "moderationDeletionJobs"\)/);
assert.match(source, /where\("status",\s*"in",\s*\["queued",\s*"failed",\s*"processing"\]\)/,
  "the live deletion listener is restricted to active jobs");
assert.match(source, /limit\(200\)/, "active moderation work is bounded");
assert.match(source, /getDoc\(doc\(db, "moderationDeletionJobs", key\)\)/,
  "pending targets use targeted reads to discover completed ID tombstones");
assert.match(source, /moderationJobObservationHealthy/);
assert.match(source, /blocked:\s*busy\s*\|\|\s*!state\.moderationJobObservationHealthy/,
  "moderation controls fail closed when job observation is unavailable");
assert.match(source, /collection\(db, "roomMessages"\)[\s\S]*where\("roomId",\s*"==",\s*roomId\)/,
  "room evidence is queried only for a reported room");
assert.match(source, /getCountFromServer/);
assert.match(source, /startAfter/);
assert.match(source, /loadMoreRoomEvidence/);
assert.doesNotMatch(source, /observe\(collection\(db, "roomMessages"\)/,
  "the dashboard never subscribes to every private temporary message");
assert.match(source, /create\("img"\)/);
assert.match(source, /referrerPolicy\s*=\s*row\.imagePreview\.referrerPolicy/);
assert.match(source, /row\.imagePreview\.kind\s*===\s*"placeholder"/);
assert.doesNotMatch(source, /image\.src\s*=\s*row\.imagePreview\.src[\s\S]*if \(row\.imagePreview\)/,
  "admin previews branch on a trusted presentation before assigning src");
assert.doesNotMatch(source, /innerHTML/, "reported previews must use DOM text and image properties only");
assert.doesNotMatch(source, /deletePostDependencies|roomDocumentsForFinalBatch/,
  "the browser must never destructively page moderation dependents");
assert.doesNotMatch(source, /collection\(db, "communityVotes"\).*where\("postId"/s,
  "timeline post deletion must not erase community votes by shared ID in browser code");

console.log("Administrator moderation queue behavior passed");
