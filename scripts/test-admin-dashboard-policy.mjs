import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { adminDeletionQueuePayloads } from "../admin-deletion-policy.mjs";
import {
  canConfirmDeletion,
  deletionJobRecord,
  deletionDialogJobTransition,
  filterUsers,
  filterModerationCases,
  generalContentDeletionPayloads,
  generalContentDeletionWriteMode,
  legacyRoomActionPayload,
  isTerminalModerationAction,
  moderationActionPayload,
  moderationActionRetryPayload,
  moderationActionState,
  moderationCaseRecord,
  moderationEvidenceMedia,
  processorHealth,
  queueFailureDialogTransition,
  resolveReportActionFocus,
  resolveUserFocus,
  statusForUser,
  sortInactiveUsers
} from "../admin-dashboard-policy.mjs";

const now = Date.UTC(2026, 7, 28, 12, 0, 0);
const day = 24 * 60 * 60 * 1000;
const user = (id, username, lastActiveAt, extra = {}) => ({ id, username, lastActiveAt, ...extra });

// A wrong cutoff comparator, malformed-date coercion, or status ordering must fail these tests.
assert.equal(statusForUser(user("equal", "equal", now - 7 * day), { now }).kind, "inactive");
assert.equal(statusForUser(user("recent", "recent", now - 7 * day + 1), { now }).kind, "active");
assert.equal(statusForUser(user("unknown", "unknown", "yesterday"), { now }).kind, "activity-not-recorded");
assert.equal(statusForUser(user("banned", "banned", "bad", { banned: true }), { now }).kind, "banned");
assert.equal(statusForUser(user("queued", "queued", "bad", { banned: true }), { now, deletionJobs: new Map([["queued", { status: "failed" }]]) }).kind, "deletion-pending");

const users = [
  user("active", "alpha", now - day),
  user("inactive-newer", "bravo", now - 8 * day),
  user("inactive-older", "charlie", now - 20 * day),
  user("banned", "delta", now - 20 * day, { banned: true }),
  user("pending", "echo", now - 20 * day),
  user("unknown", "foxtrot", null)
];
const jobs = new Map([["pending", { status: "queued" }]]);
assert.deepEqual(filterUsers(users, { filter: "inactive", now, deletionJobs: jobs }).map(({ id }) => id), ["inactive-newer", "inactive-older"]);
assert.deepEqual(sortInactiveUsers(users, { now, deletionJobs: jobs }).map(({ id }) => id), ["inactive-older", "inactive-newer"]);
assert.deepEqual(filterUsers(users, { filter: "deletion-pending", now, deletionJobs: jobs }).map(({ id }) => id), ["pending"]);
assert.deepEqual(filterUsers(users, { filter: "activity-not-recorded", now, deletionJobs: jobs }).map(({ id }) => id), ["unknown"]);

assert.equal(canConfirmDeletion({ typedUsername: "Target", targetUsername: "Target", blocked: false }), true);
assert.equal(canConfirmDeletion({ typedUsername: "target", targetUsername: "Target", blocked: false }), false);
assert.equal(canConfirmDeletion({ typedUsername: "Target ", targetUsername: "Target", blocked: false }), false);
assert.equal(canConfirmDeletion({ typedUsername: "Target", targetUsername: "Target", blocked: true }), false);
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target" }, { pathId: "other", hasPendingWrites: false, data: { status: "queued" } }), { open: true, targetUid: "target" });
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target" }, { pathId: "target", hasPendingWrites: false, data: { status: "failed" } }), {
  open: false,
  targetUid: "target",
  feedback: "This account is already locked for permanent deletion and needs attention."
});
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target", submitting: true }, {
  pathId: "target", hasPendingWrites: true, data: { id: "other", status: "queued" }
}), { open: true, targetUid: "target", submitting: true });
assert.deepEqual(deletionJobRecord("target", { id: "other", status: "queued" }, false), {
  pathId: "target", data: { id: "other", status: "queued" }, hasPendingWrites: false
});
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target", submitting: true }, {
  pathId: "target", hasPendingWrites: false, data: { id: "other", status: "queued" }
}), {
  open: false,
  targetUid: "target",
  submitting: true,
  feedback: "Account locked. Permanent deletion queued."
});
assert.deepEqual(queueFailureDialogTransition({ open: true, targetUid: "target", submitting: true }, {
  pathId: "target", hasPendingWrites: false, data: { status: "completed" }
}), { open: false, targetUid: "target", submitting: true, feedback: "Account locked. Permanent deletion queued." });
assert.deepEqual(queueFailureDialogTransition({ open: true, targetUid: "target", submitting: true }, {
  pathId: "target", hasPendingWrites: true, data: { status: "queued" }
}), { open: true, targetUid: "target", submitting: false, feedback: "Could not queue permanent deletion. No changes were made." });
assert.deepEqual(deletionDialogJobTransition({ open: true, targetUid: "target" }, {
  pathId: "other", hasPendingWrites: false, data: { id: "target", status: "queued" }
}), { open: true, targetUid: "target" });
assert.equal(resolveUserFocus({ activeFocusKey: "manage-delete-target", availableFocusKeys: ["manage-delete-target"], fallbackFocusKey: "admin-user-search" }), "manage-delete-target");
assert.equal(resolveUserFocus({ activeFocusKey: "manage-delete-target", availableFocusKeys: [], fallbackFocusKey: "admin-user-search" }), "admin-user-search");
// This DOM seam receives the still-focusable report controls after a row is replaced.
assert.equal(resolveReportActionFocus({ sourceFocusKey: "report-restore-case", sameReportFocusKeys: ["report-restore-case", "report-ban-case"], availableFocusKeys: ["report-restore-case", "report-ban-case"], fallbackFocusKey: "admin-report-status" }), "report-restore-case");
assert.equal(resolveReportActionFocus({ sourceFocusKey: "report-restore-case", sameReportFocusKeys: ["report-ban-case"], availableFocusKeys: ["report-ban-case"], fallbackFocusKey: "admin-report-status" }), "report-ban-case");
assert.equal(resolveReportActionFocus({ sourceFocusKey: "report-restore-case", sameReportFocusKeys: [], availableFocusKeys: [], fallbackFocusKey: "admin-report-status" }), "admin-report-status");

assert.equal(processorHealth({ status: "started", updatedAt: now - 10 * 60 * 1000 }, now).kind, "working");
assert.equal(processorHealth({ status: "completed", updatedAt: now - 10 * 60 * 1000 - 1 }, now).kind, "delayed");
assert.equal(processorHealth({ status: "started", updatedAt: now - 20 * 60 * 1000 }, now).kind, "delayed");
assert.equal(processorHealth({ status: "completed", updatedAt: now - 20 * 60 * 1000 - 1 }, now).kind, "not-running");
assert.equal(processorHealth({ status: "error", updatedAt: now }, now).kind, "not-running");
assert.equal(processorHealth({ status: "working", updatedAt: now }, now).kind, "not-running");
assert.equal(processorHealth({ updatedAt: now }, now).kind, "not-running");
assert.equal(processorHealth({ status: "started", updatedAt: "unknown" }, now).kind, "not-running");

// Removing the case-time sort, the canonical-ID tie-breaker, or an explicit status branch must fail these queue views.
const moderationCases = [
  moderationCaseRecord("post-a", { status: "open", targetKind: "post", createdAt: now - 1_000, snapshot: { text: "Older public post" } }),
  moderationCaseRecord("post-b", { status: "open", targetKind: "post", createdAt: now, snapshot: { text: "Newest public post" } }),
  moderationCaseRecord("post-a-tied", { status: "open", targetKind: "post", createdAt: now, snapshot: { text: "Tied public post" } }),
  moderationCaseRecord("deleted-soon", { status: "deleteQueued", targetKind: "post", createdAt: now - 500, snapshot: { text: "Deleting" } }),
  moderationCaseRecord("restored", { status: "restored", targetKind: "post", createdAt: now + 1, snapshot: { text: "Restored" } }),
  moderationCaseRecord("expired", { status: "expiredEvidence", targetKind: "roomMessage", createdAt: now + 2, snapshot: { text: "Expired" } })
];
assert.deepEqual(filterModerationCases(moderationCases, { filter: "open" }).map(({ id }) => id), ["post-a-tied", "post-b", "deleted-soon", "post-a"]);
assert.deepEqual(filterModerationCases(moderationCases, { filter: "restored" }).map(({ id }) => id), ["restored"]);
assert.deepEqual(filterModerationCases(moderationCases, { filter: "expiredEvidence" }).map(({ id }) => id), ["expired"]);
assert.deepEqual(filterModerationCases(moderationCases, { filter: "all" }).map(({ id }) => id), ["expired", "restored", "post-a-tied", "post-b", "deleted-soon", "post-a"]);

// Removing the preview limit would expose a large evidence snapshot in the live list.
assert.equal(moderationCaseRecord("long", { status: "open", targetKind: "post", snapshot: { text: "x".repeat(600) } }).preview, "x".repeat(240));
const evidencePhoto = "data:image/jpeg;base64,AAAA";
assert.deepEqual(moderationEvidenceMedia({ snapshot: { media: [{ kind: "postImage", dataUrl: evidencePhoto }, { kind: "coverImage", dataUrl: "javascript:alert(1)" }] } }), [{ kind: "postImage", dataUrl: evidencePhoto, label: "Reported post image" }]);
assert.deepEqual(moderationEvidenceMedia({ snapshot: { media: Array.from({ length: 5 }, () => ({ kind: "profileImage", dataUrl: evidencePhoto })) } }).length, 2, "the queue renders a bounded number of evidence images");
assert.deepEqual(moderationEvidenceMedia({ items: [{ kind: "coverImage", dataUrl: evidencePhoto }] }), [{ kind: "coverImage", dataUrl: evidencePhoto, label: "Reported profile cover image" }], "protected evidence loads from its lazy child document");

const ordinaryCase = moderationCaseRecord("ordinary", {
  status: "open", targetKind: "post", reportedUserId: "ordinary-user", snapshot: { authorName: "ordinary_user" }
});
assert.deepEqual(moderationActionState({ caseRecord: ordinaryCase, action: { action: "restore", status: "queued" } }), {
  locked: true,
  feedback: "Restore material queued.",
  restore: { disabled: true },
  deleteMaterial: { disabled: true },
  ban: { disabled: true },
  deleteProfile: { disabled: true }
});
assert.equal(moderationActionState({ caseRecord: ordinaryCase, action: { action: "deleteMaterial", status: "failed" } }).feedback, "Delete material permanently needs attention and will retry.");
assert.equal(moderationActionState({ caseRecord: ordinaryCase, action: { action: "restore", status: "failed", attempts: 7 } }).locked, true);
const terminalAction = { action: "restore", status: "failed", attempts: 8, requestedBy: "original-admin" };
const terminalState = moderationActionState({ caseRecord: ordinaryCase, action: terminalAction });
assert.equal(isTerminalModerationAction(terminalAction), true);
assert.equal(terminalState.locked, false);
assert.equal(terminalState.feedback, "Restore material stopped after repeated failures. Retry this action.");
assert.equal(terminalState.restore.disabled, false);
assert.equal(terminalState.deleteMaterial.disabled, true);
const settledTerminalAction = { ...terminalAction, status: "terminal" };
assert.equal(isTerminalModerationAction(settledTerminalAction), true, "processor-settled terminal actions remain manually retryable");
assert.equal(moderationActionState({ caseRecord: ordinaryCase, action: settledTerminalAction }).feedback, "Restore material stopped after repeated failures. Retry this action.");
assert.equal(moderationActionState({ caseRecord: ordinaryCase, action: { action: "restore", status: "leased" } }).restore.disabled, true);
assert.equal(moderationActionState({ caseRecord: moderationCaseRecord("queued-delete", { status: "deleteQueued", targetKind: "post" }) }).feedback, "Delete material permanently queued.");
const deleteQueuedCase = moderationCaseRecord("terminal-delete", { status: "deleteQueued", targetKind: "post", snapshot: { authorName: "ordinary_user" } });
const terminalDeleteAction = { action: "deleteMaterial", status: "terminal", attempts: 8, requestedBy: "original-admin" };
const terminalDeleteState = moderationActionState({ caseRecord: deleteQueuedCase, action: terminalDeleteAction });
assert.equal(terminalDeleteState.locked, false, "terminal delete overrides the stale deleteQueued lock for its manual retry");
assert.equal(terminalDeleteState.feedback, "Delete material permanently stopped after repeated failures. Retry this action.");
assert.equal(terminalDeleteState.deleteMaterial.disabled, false);
assert.equal(terminalDeleteState.restore.disabled, true);
assert.equal(terminalDeleteState.ban.disabled, true);
assert.equal(terminalDeleteState.deleteProfile.disabled, true);
const nonterminalDeleteState = moderationActionState({ caseRecord: deleteQueuedCase, action: { action: "deleteMaterial", status: "failed", attempts: 7 } });
assert.equal(nonterminalDeleteState.locked, true, "ordinary deleteQueued failures remain locked");
assert.equal(nonterminalDeleteState.feedback, "Delete material permanently queued.");
assert.equal(nonterminalDeleteState.deleteMaterial.disabled, true);

const protectedCase = moderationCaseRecord("protected", {
  status: "open", targetKind: "post", reportedUserId: "protected-user", snapshot: { authorName: "CyberCapone" }
});
const protectedState = moderationActionState({ caseRecord: protectedCase });
assert.equal(protectedState.ban.disabled, true);
assert.equal(protectedState.deleteProfile.disabled, true);
assert.equal(protectedState.restore.disabled, false);
assert.equal(moderationActionState({ caseRecord: protectedCase, username: "ordinary_user" }).ban.disabled, false);
assert.equal(moderationActionState({ caseRecord: ordinaryCase, username: "CyberCapone" }).deleteProfile.disabled, true);

const expiredCase = moderationCaseRecord("expired-action", { status: "expiredEvidence", targetKind: "roomMessage", snapshot: { authorName: "ordinary_user" } });
assert.equal(moderationActionState({ caseRecord: expiredCase }).restore.disabled, true);
assert.equal(moderationActionState({ caseRecord: expiredCase }).deleteMaterial.disabled, false);
const userCase = moderationCaseRecord("user-action", { status: "open", targetKind: "user", snapshot: { authorName: "ordinary_user" } });
assert.equal(moderationActionState({ caseRecord: userCase }).deleteMaterial.disabled, true);

const serverTimestamp = { sentinel: "serverTimestamp" };
assert.deepEqual(moderationActionPayload({ caseRecord: ordinaryCase, action: "restore", requestedBy: "admin", requestedAt: serverTimestamp }), {
  action: "restore", requestedAt: serverTimestamp, requestedBy: "admin", status: "queued"
});
assert.deepEqual(moderationActionRetryPayload({ caseRecord: ordinaryCase, action: "restore", existingAction: terminalAction, requestedAt: serverTimestamp }), {
  action: "restore", requestedAt: serverTimestamp, requestedBy: "original-admin", status: "queued"
});
assert.deepEqual(moderationActionRetryPayload({ caseRecord: ordinaryCase, action: "restore", existingAction: settledTerminalAction, requestedAt: serverTimestamp }), {
  action: "restore", requestedAt: serverTimestamp, requestedBy: "original-admin", status: "queued"
});
assert.deepEqual(moderationActionRetryPayload({ caseRecord: deleteQueuedCase, action: "deleteMaterial", existingAction: terminalDeleteAction, requestedAt: serverTimestamp }), {
  action: "deleteMaterial", requestedAt: serverTimestamp, requestedBy: "original-admin", status: "queued"
});
assert.throws(() => moderationActionRetryPayload({ caseRecord: ordinaryCase, action: "deleteMaterial", existingAction: terminalAction, requestedAt: serverTimestamp }));
assert.throws(() => moderationActionPayload({ caseRecord: userCase, action: "deleteMaterial", requestedBy: "admin", requestedAt: serverTimestamp }));
assert.throws(() => moderationActionPayload({ caseRecord: expiredCase, action: "restore", requestedBy: "admin", requestedAt: serverTimestamp }));
assert.deepEqual(generalContentDeletionPayloads({ id: "post-one", type: "timeline", authorId: "author", requestedBy: "admin", requestedAt: serverTimestamp }), {
  id: "post_post-one",
  moderationCase: {
    targetKind: "post", targetCollection: "posts", targetId: "post-one", targetPath: "posts/post-one",
    reportedUserId: "author", snapshot: { kind: "queuedAdminDeletion" }, status: "deleteQueued",
    reportCount: 0, reasonTotals: {}, createdAt: serverTimestamp, updatedAt: serverTimestamp
  },
  action: { action: "deleteMaterial", requestedAt: serverTimestamp, requestedBy: "admin", status: "queued" }
});
assert.throws(() => generalContentDeletionPayloads({ id: "post/one", type: "timeline", authorId: "author", requestedBy: "admin", requestedAt: serverTimestamp }));
assert.equal(generalContentDeletionPayloads({ id: "community", type: "community", authorId: "author", requestedBy: "admin", requestedAt: serverTimestamp }).id, "communityPost_community");
assert.equal(generalContentDeletionWriteMode({ caseExists: false, actionExists: false }), "case-and-action");
assert.equal(generalContentDeletionWriteMode({ caseExists: true, actionExists: false }), "action-only");
assert.equal(generalContentDeletionWriteMode({ caseExists: true, actionExists: true }), "blocked");
assert.equal(generalContentDeletionWriteMode({ caseExists: false, actionExists: true }), "blocked");
assert.deepEqual(adminDeletionQueuePayloads({ targetUid: "ordinary-user", requesterUid: "admin", timestamp: serverTimestamp }), {
  profile: { banned: true, adminDeletionRequestedAt: serverTimestamp, adminDeletionRequestedBy: "admin", adminDeletionStatus: "queued" },
  job: { targetUid: "ordinary-user", requesterUid: "admin", requestedAt: serverTimestamp, status: "queued" }
});
for (const action of ["retryCleanup", "approveCleanup", "release"]) assert.deepEqual(
  legacyRoomActionPayload({ roomId: "legacy-room", action, requestedBy: "admin", requestedAt: serverTimestamp }),
  { roomId: "legacy-room", action, requestedAt: serverTimestamp, requestedBy: "admin", status: "queued" }
);
assert.throws(() => legacyRoomActionPayload({ roomId: "../room", action: "release", requestedBy: "admin", requestedAt: serverTimestamp }));

const adminSource = await readFile(new URL("../admin.js", import.meta.url), "utf8");
assert.doesNotMatch(adminSource, /deleteDoc\(doc\(db,\s*entry\.type/, "general moderation cannot directly delete a parent post");
assert.match(adminSource, /batch\.set\(doc\(db, "moderationCases", payloads\.id\), payloads\.moderationCase\)/);
assert.match(adminSource, /batch\.set\(doc\(db, "moderationActions", payloads\.id\), payloads\.action\)/);
assert.match(adminSource, /writeMode === "action-only"\) await setDoc\(doc\(db, "moderationActions", payloads\.id\), payloads\.action\)/,
  "an existing moderation case queues only its permitted action document");
assert.match(adminSource, /writeMode === "blocked" \? "Review moderation case" : "Delete"/,
  "an existing action has a visible non-destructive status");
assert.match(adminSource, /Permanent content deletion queued\. The trusted processor will remove descendants\./);

assert.match(adminSource, /getDoc\(doc\(db, "moderationCases", item\.id, "evidence", "media"\)\)/, "protected media evidence is loaded only on demand");
assert.match(adminSource, /where\("status", "in", reportStatuses\(\)\).*orderBy\("updatedAt", "desc"\).*startAfter\(reportPageCursors\.at\(-1\)\).*limit\(reportPageSize\)/s, "reported-material views are status-filtered, cursor-paginated, and bounded on the server");
assert.match(adminSource, /onSnapshot\(doc\(db, "moderationActions", id\)/, "every visible case gets its deterministic action state");
assert.match(adminSource, /admin-reports-load-more/, "the bounded reported-material queue can load more history");
assert.match(adminSource, /legacyRoomActionPayload/, "manual-review rooms expose audited administrator actions");
assert.match(adminSource, /legacyRoomPageCursors.*startAfter/s, "legacy manual review is cursor-paginated beyond the first bounded page");
assert.match(adminSource, /evictModerationEvidence/, "protected evidence cache is evicted on navigation and permanent deletion");
assert.match(adminSource, /moderationEvidenceEpochs\.get\(item\.id\) !== loadEpoch/, "an evicted in-flight evidence load cannot repopulate the protected cache");

console.log("Admin dashboard policy behavior passed");
