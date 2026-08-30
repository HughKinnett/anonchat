import { auth, db } from "./firebase-config.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { adminDeletionQueuePayloads, canAdminSetBanned, canQueueAdminDeletion, isProtectedAdministrator, normalizeUsername } from "./admin-deletion-policy.mjs";
import { canConfirmDeletion, deletionDialogJobTransition, deletionJobRecord, filterModerationCases, filterUsers, generalContentDeletionPayloads, generalContentDeletionWriteMode, hasDeletionJob, isTerminalModerationAction, legacyRoomActionPayload, moderationActionPayload, moderationActionRetryPayload, moderationActionState, moderationActionsAvailable, moderationCaseRecord, moderationTranscriptMessage, processorHealth, queueFailureDialogTransition, resolveReportActionFocus, resolveUserFocus, sortInactiveUsers, statusForUser, timestampMillis } from "./admin-dashboard-policy.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { multiFactor, onAuthStateChanged, TotpMultiFactorGenerator } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection, collectionGroup, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { users: [], posts: [], communityPosts: [], views: [], comments: [], reactions: [], follows: [], circles: [], members: [], rooms: [], votes: [], jobs: new Map(), moderationCases: [], moderationActions: new Map(), legacyRooms: [], processor: null, moderationProcessor: null, moderationProcessorListenerHealthy: false };
const unsubs = [];
let adminUid = "", adminUser = null, userFilter = "all", reportFilter = "open", pageActive = true, listenersStarted = false, heartbeatTimer = null;
let dialogState = { open: false, targetUid: "", submitting: false }, dialogTarget = null, dialogTrigger = null;
let pendingAdminTotpSecret = null;
const pendingModerationActions = new Map();
const pendingLegacyRoomActions = new Set(), loadedModerationEvidence = new Map(), loadedRoomTranscripts = new Map(), reportActionUnsubs = new Map();
const moderationEvidenceEpochs = new Map(), roomTranscriptEpochs = new Map();
let reportCasesUnsub = null, legacyRoomsUnsub = null, reportPageLast = null, legacyRoomPageLast = null;
const reportPageSize = 100, reportPageCursors = [];
const roomTranscriptPageSize = 100;
const legacyRoomPageSize = 100, legacyRoomPageCursors = [];

const setStatus = (message, error = false) => { $("admin-status").textContent = message; $("admin-status").style.color = error ? "#fca5a5" : ""; };
const setAuthenticatorStatus = (message) => { $("admin-authenticator-status").textContent = message; };

$("admin-authenticator-start").onclick = async () => {
  if (!adminUser) { setAuthenticatorStatus("Administrator access is still loading. Wait a moment and try again."); return; }
  setAuthenticatorStatus("Preparing authenticator setup…");
  try {
    pendingAdminTotpSecret = await TotpMultiFactorGenerator.generateSecret(await multiFactor(adminUser).getSession());
    $("admin-authenticator-secret").textContent = pendingAdminTotpSecret.secretKey;
    $("admin-authenticator-open").href = pendingAdminTotpSecret.generateQrCodeUrl(adminUser.email || "AnonChat admin", "AnonChat");
    $("admin-authenticator-setup").hidden = false;
    setAuthenticatorStatus("Add the key, then confirm the current code.");
  } catch (error) {
    const messages = {
      "auth/requires-recent-login": "For security, sign out and sign back in before setting up the authenticator.",
      "auth/unverified-email": "Verify this administrator account's email before setting up the authenticator.",
      "auth/operation-not-allowed": "Authenticator support is not enabled in Firebase yet.",
      "auth/unsupported-first-factor": "This account's current sign-in method cannot be used with an authenticator.",
      "auth/maximum-second-factor-count-exceeded": "This account already has the maximum number of sign-in factors."
    };
    setAuthenticatorStatus(messages[error?.code] || `Setup could not start (${error?.code || "browser-error"}). Refresh once and retry.`);
  }
};

$("admin-authenticator-confirm").onclick = async () => {
  const code = $("admin-authenticator-code").value.replace(/\s/g, "");
  if (!pendingAdminTotpSecret || !/^\d{6}$/.test(code)) { setAuthenticatorStatus("Enter the current 6-digit code."); return; }
  try {
    await multiFactor(adminUser).enroll(TotpMultiFactorGenerator.assertionForEnrollment(pendingAdminTotpSecret, code), "AnonChat administrator authenticator");
    pendingAdminTotpSecret = null;
    $("admin-authenticator-setup").hidden = true;
    $("admin-authenticator-start").hidden = true;
    setAuthenticatorStatus("Authenticator protection is enabled on this administrator account.");
  } catch { setAuthenticatorStatus("That code was not accepted. Wait for a new code and try again."); }
};
const records = snapshot => snapshot.docs.map(entry => ({ id: entry.id, parentId: entry.ref.parent.parent?.id, ...entry.data() }));
const formatDate = value => { const ms = timestampMillis(value); return ms === null ? "Activity not recorded" : new Date(ms).toLocaleString(); };
const create = (name, text, className) => { const node = document.createElement(name); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const empty = message => create("p", message, "admin-note");
const pct = (part, total) => total ? Math.round(part / total * 100) : 0;
const jobFor = uid => state.jobs.get(uid);
const jobMessage = user => jobFor(user.id)?.data?.status === "failed" ? "Deletion Pending — needs attention" : "Deletion Pending";
const userOptions = () => ({ now: Date.now(), deletionJobs: state.jobs });
const focusKey = (scope, action, uid) => `${scope}-${action}-${uid}`;
const controlByFocusKey = key => [...document.querySelectorAll("[data-focus-key]")].find(node => node.dataset.focusKey === key);
const currentUserFocusKey = () => document.activeElement?.closest?.("[data-focus-key]")?.dataset.focusKey || "";
const moderationControlsReady = () => moderationActionsAvailable({
  listenerHealthy: state.moderationProcessorListenerHealthy,
  processor: state.moderationProcessor
});
const evictModerationEvidence = (id) => {
  moderationEvidenceEpochs.set(id, (moderationEvidenceEpochs.get(id) || 0) + 1);
  const media = loadedModerationEvidence.get(id) || [];
  media.forEach((item) => { if (item?.objectUrl) URL.revokeObjectURL(item.objectUrl); });
  loadedModerationEvidence.delete(id);
};
const evictRoomTranscript = (id) => {
  roomTranscriptEpochs.set(id, (roomTranscriptEpochs.get(id) || 0) + 1);
  loadedRoomTranscripts.delete(id);
};

function activityByUser() {
  const points = new Map(), add = (uid, amount = 1) => { if (uid) points.set(uid, (points.get(uid) || 0) + amount); };
  state.posts.forEach(entry => add(entry.authorId, 3)); state.communityPosts.forEach(entry => add(entry.authorId, 3));
  state.comments.forEach(entry => add(entry.uid, 2)); state.reactions.forEach(entry => add(entry.uid));
  state.follows.forEach(entry => add(entry.followerId));
  return points;
}

function renderMetrics() {
  const options = userOptions(), active = filterUsers(state.users, { ...options, filter: "active" });
  const inactive = filterUsers(state.users, { ...options, filter: "inactive" });
  $("metric-users").textContent = state.users.length; $("metric-inactive").textContent = inactive.length;
  const banned = filterUsers(state.users, { ...options, filter: "banned" }).length;
  $("metric-banned").textContent = banned;
  $("metric-content").textContent = state.posts.length + state.communityPosts.length;
  $("metric-active-users").textContent = active.length; $("metric-views").textContent = state.views.reduce((sum, entry) => sum + (entry.views || 0), 0);
  $("metric-posts").textContent = state.posts.length; $("metric-community-posts").textContent = state.communityPosts.length;
  $("metric-comments").textContent = state.comments.length; $("metric-reactions").textContent = state.reactions.length;
  $("metric-follows").textContent = state.follows.length; $("metric-circles").textContent = state.circles.length;
  $("metric-rooms").textContent = state.rooms.length; $("metric-poll-votes").textContent = state.votes.length;
  $("metric-banned-detail").textContent = banned;
  const days = Number($("metric-window").value), cutoff = Date.now() - days * 86400000;
  const inWindow = value => !days || (timestampMillis(value) ?? 0) >= cutoff;
  const newUsers = state.users.filter(user => inWindow(user.createdAt)).length;
  $("metric-new-users-detail").textContent = newUsers; $("metric-new-users").textContent = `${newUsers} new in window`;
  $("metric-engaged-users").textContent = `${activityByUser().size} engaged`;
  $("metric-ban-rate").textContent = `${pct(banned, state.users.length)}% of users`;
  $("metric-window-views").textContent = `${state.views.filter(entry => new Date(`${entry.id}T23:59:59`).getTime() >= cutoff).reduce((sum, entry) => sum + (entry.views || 0), 0)} in window`;
  $("last-updated").textContent = `Live data updated ${new Date().toLocaleTimeString()}`;
}

function renderUserRow(user, scope) {
  const status = statusForUser(user, userOptions()), locked = state.jobs.has(user.id) || ["adminDeletionRequestedAt", "adminDeletionRequestedBy", "adminDeletionStatus"].some(key => key in user);
  const protectedAdmin = isProtectedAdministrator(user.username), row = create("article", undefined, "admin-row"), info = create("div");
  info.append(create("strong", `@${user.username || "Unknown user"}`), create("small", status.kind === "deletion-pending" ? jobMessage(user) : status.label, `user-status status-${status.kind}`), create("small", `Last active: ${formatDate(user.lastActiveAt)}`));
  const actions = create("div", undefined, "admin-actions"), profile = create("a", "View Profile", "admin-action nav-button");
  profile.href = `profile.html?uid=${encodeURIComponent(user.id)}`; profile.dataset.focusKey = focusKey(scope, "profile", user.id);
  const ban = create("button", protectedAdmin ? "Protected administrator" : user.banned ? "Unban" : "Ban", `admin-action ${user.banned ? "restore" : "danger"}`);
  ban.type = "button"; ban.dataset.focusKey = focusKey(scope, "ban", user.id);
  ban.disabled = protectedAdmin || !canAdminSetBanned({ username: user.username, nextBanned: !user.banned, existingJob: locked, existingQueueState: locked });
  ban.onclick = async () => { ban.disabled = true; try { await updateDoc(doc(db, "users", user.id), { banned: !user.banned }); setStatus(user.banned ? "Account unbanned." : "Account banned."); } catch { setStatus("Could not update that account.", true); renderUsers(); } };
  const remove = create("button", "Delete Account", "admin-action danger");
  remove.type = "button"; remove.dataset.focusKey = focusKey(scope, "delete", user.id);
  remove.disabled = protectedAdmin || !canQueueAdminDeletion({ targetUid: user.id, username: user.username, existingJob: locked, existingQueueState: locked });
  remove.onclick = () => openDeletionDialog(user, remove);
  actions.append(profile, ban, remove); row.append(info, actions); return row;
}

function restoreUserFocus(activeFocusKey) {
  if (!activeFocusKey) return;
  const availableFocusKeys = [...document.querySelectorAll("[data-focus-key]")].map(node => node.dataset.focusKey);
  const next = resolveUserFocus({ activeFocusKey, availableFocusKeys, fallbackFocusKey: "admin-user-search" });
  (next === "admin-user-search" ? $("admin-user-search") : controlByFocusKey(next))?.focus();
}

function renderUsers() {
  const activeFocusKey = currentUserFocusKey();
  const options = { ...userOptions(), filter: userFilter, search: $("admin-user-search").value.trim() };
  const users = filterUsers(state.users, options).sort((left, right) => String(left.username || "").localeCompare(String(right.username || "")));
  $("admin-users").replaceChildren(...(users.length ? users.map(user => renderUserRow(user, "manage")) : [empty("No accounts match this view.")]));
  const inactive = sortInactiveUsers(state.users, userOptions());
  $("inactive-users").replaceChildren(...(inactive.length ? inactive.map(user => renderUserRow(user, "inactive")) : [empty("No eligible inactive accounts right now.")]));
  restoreUserFocus(activeFocusKey);
}

const reportTypeLabel = kind => ({ post: "Timeline post", communityPost: "Community post", room: "Temporary chat room", roomMessage: "Room message", user: "User profile" }[kind] || "Reported material");
const reportStatusLabel = status => ({ open: "Needs review", restored: "Restored", deleted: "Deleted", deleteQueued: "Permanent deletion queued", expiredEvidence: "Source expired — evidence retained" }[status] || "Needs review");
const reportReasonLabel = item => {
  const reasons = Object.entries(item.reasonTotals || {}).filter(([, count]) => Number(count) > 0)
    .map(([reason, count]) => `${String(reason).replaceAll("-", " ")} (${count})`);
  return reasons.length ? reasons.join(", ") : "Not available";
};
const reportUser = item => state.users.find(user => user.id === item.reportedUserId);
const reportDeletionPending = item => {
  const user = reportUser(item);
  return Boolean(user && hasDeletionJob(user, state.jobs));
};
const reportAction = item => pendingModerationActions.get(item.id) || state.moderationActions.get(item.id);

async function loadRoomTranscriptPage(item) {
  if (item.targetKind !== "room") return;
  const transcript = loadedRoomTranscripts.get(item.id) || { messages: [], cursor: null, complete: false, loading: false };
  if (transcript.loading || transcript.complete) return;
  const epoch = roomTranscriptEpochs.get(item.id) || 0;
  loadedRoomTranscripts.set(item.id, { ...transcript, loading: true, error: "" });
  renderReports();
  try {
    const transcriptQuery = transcript.cursor
      ? query(collection(db, "roomMessages"), where("roomId", "==", item.targetId), orderBy("createdAt", "asc"), orderBy(documentId(), "asc"), startAfter(transcript.cursor), limit(roomTranscriptPageSize))
      : query(collection(db, "roomMessages"), where("roomId", "==", item.targetId), orderBy("createdAt", "asc"), orderBy(documentId(), "asc"), limit(roomTranscriptPageSize));
    const snapshot = await getDocs(transcriptQuery);
    if (!listenersStarted || !pageActive || roomTranscriptEpochs.get(item.id) !== epoch
      || !state.moderationCases.some((entry) => entry.id === item.id)) return;
    loadedRoomTranscripts.set(item.id, {
      messages: [...transcript.messages, ...snapshot.docs.map((entry) => moderationTranscriptMessage(entry.id, entry.data()))],
      cursor: snapshot.docs.at(-1) ?? transcript.cursor,
      complete: snapshot.size < roomTranscriptPageSize,
      loading: false,
      error: ""
    });
    renderReports();
  } catch {
    if (roomTranscriptEpochs.get(item.id) !== epoch) return;
    loadedRoomTranscripts.set(item.id, { ...transcript, loading: false, error: "Could not load this room transcript." });
    setStatus("Could not load this room transcript.", true);
    renderReports();
  }
}

const reportFocus = () => {
  const control = document.activeElement?.closest?.("[data-focus-key]");
  return control ? { sourceFocusKey: control.dataset.focusKey, reportId: control.dataset.reportId } : {};
};
function restoreReportFocus({ sourceFocusKey, reportId } = {}) {
  if (!sourceFocusKey) return;
  const controls = [...document.querySelectorAll("[data-focus-key]")];
  const availableFocusKeys = controls.filter(node => !node.disabled).map(node => node.dataset.focusKey);
  const sameReportFocusKeys = controls.filter(node => node.dataset.reportId === reportId && !node.disabled).map(node => node.dataset.focusKey);
  const next = resolveReportActionFocus({ sourceFocusKey, sameReportFocusKeys, availableFocusKeys, fallbackFocusKey: "admin-report-status" });
  (next === "admin-report-status" ? $("admin-report-status") : controlByFocusKey(next))?.focus();
}

async function queueModerationAction(item, action, control) {
  const directPostAction = ["post", "communityPost"].includes(item.targetKind)
    && ["restore", "deleteMaterial"].includes(action);
  if (!directPostAction && !moderationControlsReady()) {
    setStatus("Moderation actions are paused until the trusted service is healthy.", true);
    return;
  }
  const user = reportUser(item), existingAction = reportAction(item), intendedFocus = { sourceFocusKey: control.dataset.focusKey, reportId: item.id };
  const actionState = moderationActionState({ caseRecord: item, action: existingAction, deletionPending: reportDeletionPending(item), username: user?.username });
  if ((!directPostAction && actionState[action]?.disabled) || pendingModerationActions.has(item.id)) return;
  const pending = { action, status: "queued" };
  pendingModerationActions.set(item.id, pending); control.disabled = true; renderReports(intendedFocus);
  try {
    const requestedAt = serverTimestamp();
    if (directPostAction) {
      const batch = writeBatch(db);
      const materialRef = doc(db, item.targetCollection, item.targetId);
      if (action === "restore") batch.update(materialRef, { moderationState: "visible" });
      else batch.delete(materialRef);
      batch.update(doc(db, "moderationCases", item.id), {
        status: action === "restore" ? "restored" : "deleted",
        updatedAt: requestedAt,
        resolvedAt: requestedAt,
        resolvedBy: adminUid
      });
      await batch.commit();
      pendingModerationActions.delete(item.id);
      if (action === "deleteMaterial") evictModerationEvidence(item.id);
      setStatus(action === "restore" ? "Material restored immediately." : "Material permanently deleted.");
      renderReports(intendedFocus);
      return;
    }
    const terminalRetry = isTerminalModerationAction(existingAction);
    await setDoc(doc(db, "moderationActions", item.id), terminalRetry
      ? moderationActionRetryPayload({ caseRecord: item, action, existingAction, requestedAt })
      : moderationActionPayload({ caseRecord: item, action, requestedBy: adminUid, requestedAt }));
    if (action === "deleteMaterial") { evictModerationEvidence(item.id); evictRoomTranscript(item.id); }
    setStatus(terminalRetry ? "Material action queued for another attempt."
      : item.targetKind === "room" && action === "restore" ? "Room resume queued."
      : item.targetKind === "room" ? "Permanent room deletion queued."
      : action === "restore" ? "Restore material queued." : "Permanent material deletion queued.");
  } catch {
    pendingModerationActions.delete(item.id);
    setStatus(directPostAction
      ? "Could not complete that material action. No changes were made."
      : "Could not queue that material action. No changes were made.", true);
    renderReports();
  }
}

async function banReportedUser(item, control) {
  const user = reportUser(item);
  const actionState = moderationActionState({ caseRecord: item, action: reportAction(item), deletionPending: reportDeletionPending(item), username: user?.username });
  if (!user || actionState.ban.disabled || !canAdminSetBanned({ username: user.username, nextBanned: true, existingJob: reportDeletionPending(item), existingQueueState: reportDeletionPending(item) })) {
    if (!user) setStatus("That reported account is no longer available.", true);
    else if (isProtectedAdministrator(user.username)) setStatus("Protected administrator accounts cannot be banned.", true);
    return;
  }
  control.disabled = true;
  try {
    await updateDoc(doc(db, "users", user.id), { banned: true });
    setStatus("User banned.");
  } catch {
    setStatus("Could not update that account.", true);
    renderReports();
  }
}

function deleteReportedProfile(item, control) {
  const user = reportUser(item);
  const actionState = moderationActionState({ caseRecord: item, action: reportAction(item), deletionPending: reportDeletionPending(item), username: user?.username });
  if (!user || actionState.deleteProfile.disabled || !canQueueAdminDeletion({ targetUid: user.id, username: user.username, existingJob: reportDeletionPending(item), existingQueueState: reportDeletionPending(item) })) {
    if (!user) setStatus("That reported account is no longer available.", true);
    else if (isProtectedAdministrator(user.username)) setStatus("Protected administrator accounts cannot be deleted.", true);
    return;
  }
  openDeletionDialog(user, control);
}

function renderReportRow(item) {
  const user = reportUser(item), protectedUser = Boolean(user && isProtectedAdministrator(user.username));
  const actionState = moderationActionState({ caseRecord: item, action: reportAction(item), deletionPending: reportDeletionPending(item), username: user?.username });
  const row = create("article", undefined, "admin-row"), info = create("div"), actions = create("div", undefined, "admin-actions");
  const accountAvailable = Boolean(user);
  const author = item.snapshot?.authorName || "Unknown user";
  info.append(
    create("strong", reportTypeLabel(item.targetKind)),
    create("small", `Author: @${author}`),
    create("small", `Reason: ${reportReasonLabel(item)}`),
    create("small", `Reported: ${formatDate(item.createdAt ?? item.updatedAt)}`),
    create("small", `Status: ${reportStatusLabel(item.status)}`),
    create("small", item.preview, "report-preview")
  );
  const evidenceHost = create("div", undefined, "report-evidence");
  const renderEvidence = media => {
    evidenceHost.replaceChildren();
    media.forEach(({ dataUrl, label }) => {
      const image = create("img", undefined, "report-evidence-image");
      image.src = dataUrl;
      image.alt = label;
      image.loading = "lazy";
      image.decoding = "async";
      evidenceHost.append(image);
    });
  };
  if (item.snapshot?.mediaKinds?.length || item.snapshot?.media?.length) {
    const loaded = loadedModerationEvidence.get(item.id);
    if (loaded) renderEvidence(loaded);
    else {
      const loadEvidence = create("button", "Load protected image evidence", "admin-action");
      loadEvidence.type = "button";
      loadEvidence.onclick = async () => {
        loadEvidence.disabled = true;
        const loadEpoch = moderationEvidenceEpochs.get(item.id) || 0;
        try {
          const evidence = await getDoc(doc(db, "moderationCases", item.id, "evidence", "media"));
          const media = moderationEvidenceMedia(evidence.exists() ? evidence.data() : item);
          const stillVisible = state.moderationCases.some(entry => entry.id === item.id);
          if (!listenersStarted || !pageActive || !stillVisible || moderationEvidenceEpochs.get(item.id) !== loadEpoch
            || pendingModerationActions.get(item.id)?.action === "deleteMaterial") return;
          loadedModerationEvidence.set(item.id, media); renderEvidence(media);
          if (!media.length) evidenceHost.append(create("small", "Protected image evidence is unavailable.", "report-feedback"));
        } catch { loadEvidence.disabled = false; setStatus("Could not load protected image evidence.", true); }
      };
      evidenceHost.append(loadEvidence);
    }
    info.append(evidenceHost);
  }
  if (item.targetKind === "room") {
    const transcript = loadedRoomTranscripts.get(item.id);
    const transcriptHost = create("section", undefined, "room-transcript");
    transcriptHost.setAttribute("aria-label", "Reported room transcript");
    transcriptHost.append(create("strong", "Room transcript"));
    if (transcript?.messages?.length) {
      const list = create("div", undefined, "room-transcript-list");
      transcript.messages.forEach((message) => {
        const entry = create("article", undefined, "room-transcript-message");
        entry.append(create("small", `@${message.authorName || "Unknown member"} · ${formatDate(message.createdAt)}`), create("p", message.text || "Empty message"));
        list.append(entry);
      });
      transcriptHost.append(list);
    }
    if (transcript?.error) transcriptHost.append(create("small", transcript.error, "report-feedback"));
    if (!transcript?.complete) {
      const loadTranscript = create("button", transcript?.messages?.length ? "Load more messages" : "View transcript", "admin-action");
      loadTranscript.type = "button"; loadTranscript.disabled = transcript?.loading === true;
      loadTranscript.textContent = transcript?.loading ? "Loading transcript…" : loadTranscript.textContent;
      loadTranscript.onclick = () => loadRoomTranscriptPage(item);
      transcriptHost.append(loadTranscript);
    } else if (!transcript.messages.length) transcriptHost.append(create("small", "No retained messages are available.", "report-feedback"));
    info.append(transcriptHost);
  }
  if (actionState.feedback) info.append(create("small", actionState.feedback, "report-feedback"));
  if (!user) info.append(create("small", "Reported account is no longer available.", "report-feedback"));
  else if (protectedUser) info.append(create("small",
    "This administrator account cannot be banned or deleted, but its posts can still be restored or removed.",
    "report-feedback"));
  const directPostAction = ["post", "communityPost"].includes(item.targetKind);
  const postActionClosed = ["restored", "deleted", "expiredEvidence"].includes(item.status);
  const restore = create("button", item.targetKind === "room" ? "Allow room to resume" : "Restore material", "admin-action restore");
  restore.type = "button"; restore.dataset.focusKey = focusKey("report", "restore", item.id); restore.dataset.reportId = item.id;
  restore.disabled = directPostAction ? postActionClosed : actionState.restore.disabled || !moderationControlsReady();
  restore.onclick = () => queueModerationAction(item, "restore", restore);
  const removeMaterial = create("button", item.targetKind === "room" ? "Delete room permanently" : "Delete material permanently", "admin-action danger");
  removeMaterial.type = "button"; removeMaterial.dataset.focusKey = focusKey("report", "delete-material", item.id); removeMaterial.dataset.reportId = item.id;
  removeMaterial.disabled = directPostAction ? postActionClosed : actionState.deleteMaterial.disabled || !moderationControlsReady();
  removeMaterial.onclick = () => queueModerationAction(item, "deleteMaterial", removeMaterial);
  const ban = create("button", "Ban user", "admin-action danger");
  ban.type = "button"; ban.dataset.focusKey = focusKey("report", "ban", item.id); ban.dataset.reportId = item.id; ban.disabled = actionState.ban.disabled || !accountAvailable;
  ban.onclick = () => banReportedUser(item, ban);
  const removeProfile = create("button", "Delete user's profile", "admin-action danger");
  removeProfile.type = "button"; removeProfile.dataset.focusKey = focusKey("report", "delete-profile", item.id); removeProfile.dataset.reportId = item.id; removeProfile.disabled = actionState.deleteProfile.disabled || !accountAvailable;
  removeProfile.onclick = () => deleteReportedProfile(item, removeProfile);
  actions.append(restore, removeMaterial, ban, removeProfile); row.append(info, actions); return row;
}

async function queueLegacyRoomAction(item, action, control) {
  if (!moderationControlsReady()) { setStatus("Moderation actions are paused until the trusted service is healthy.", true); return; }
  if (pendingLegacyRoomActions.has(item.id)) return;
  pendingLegacyRoomActions.add(item.id); control.disabled = true;
  try {
    await addDoc(collection(db, "legacyRoomActions"), legacyRoomActionPayload({ roomId: item.id, action, requestedBy: adminUid, requestedAt: serverTimestamp() }));
    setStatus("Legacy-room review action queued.");
  } catch { pendingLegacyRoomActions.delete(item.id); control.disabled = false; setStatus("Could not queue the legacy-room action.", true); }
}

function renderLegacyRooms() {
  const rows = state.legacyRooms.map(item => {
    const row = create("article", undefined, "admin-row"), info = create("div"), actions = create("div", undefined, "admin-actions");
    info.append(create("strong", `Room ${item.id}`), create("small", `Reason: ${item.reason || "invalid lifecycle timestamp"}`), create("small", `Attempts: ${item.attempts ?? 0}`), create("small", "Manual review required before cleanup or release."));
    for (const [action, label, className] of [["retryCleanup", "Retry cleanup", ""], ["approveCleanup", "Approve cleanup", "danger"], ["release", "Release room", "restore"]]) {
      const button = create("button", label, `admin-action ${className}`); button.type = "button"; button.disabled = pendingLegacyRoomActions.has(item.id) || !moderationControlsReady();
      button.onclick = () => queueLegacyRoomAction(item, action, button); actions.append(button);
    }
    row.append(info, actions); return row;
  });
  $("legacy-room-reviews").replaceChildren(...(rows.length ? rows : [empty("No legacy rooms require manual review.")]));
}

const reportStatuses = () => reportFilter === "open" ? ["open", "deleteQueued"] : reportFilter === "all"
  ? ["open", "deleteQueued", "restored", "expiredEvidence"] : [reportFilter];
function syncReportActionListeners() {
  const visible = new Set(state.moderationCases.map(item => item.id));
  for (const [id, unsubscribe] of reportActionUnsubs) if (!visible.has(id)) { unsubscribe(); reportActionUnsubs.delete(id); state.moderationActions.delete(id); }
  for (const id of visible) if (!reportActionUnsubs.has(id)) reportActionUnsubs.set(id, onSnapshot(doc(db, "moderationActions", id), snapshot => {
    if (snapshot.exists()) state.moderationActions.set(id, snapshot.data()); else state.moderationActions.delete(id);
    if (snapshot.exists()) pendingModerationActions.delete(id); renderReports();
  }, () => setStatus("Could not load a visible reported-material action.", true)));
}
function startReportQueue() {
  reportCasesUnsub?.();
  const constraints = [where("status", "in", reportStatuses()), orderBy("updatedAt", "desc")];
  if (reportPageCursors.length) constraints.push(startAfter(reportPageCursors.at(-1)));
  constraints.push(limit(reportPageSize));
  const reportQuery = query(collection(db, "moderationCases"), ...constraints);
  reportCasesUnsub = onSnapshot(reportQuery, snapshot => {
    state.moderationCases = snapshot.docs.map(entry => moderationCaseRecord(entry.id, entry.data()));
    const visibleIds = new Set(state.moderationCases.map(item => item.id));
    for (const id of loadedModerationEvidence.keys()) if (!visibleIds.has(id)) evictModerationEvidence(id);
    for (const id of loadedRoomTranscripts.keys()) if (!visibleIds.has(id)) evictRoomTranscript(id);
    reportPageLast = snapshot.docs.at(-1) ?? null;
    syncReportActionListeners(); renderReports();
    $("admin-reports-load-more").hidden = snapshot.size < reportPageSize;
    $("admin-reports-previous").hidden = reportPageCursors.length === 0;
  }, () => setStatus("Could not load the reported-material queue.", true));
}
function startLegacyRoomQueue() {
  legacyRoomsUnsub?.();
  const constraints = [where("status", "==", "manualReview"), orderBy("terminalAt", "desc")];
  if (legacyRoomPageCursors.length) constraints.push(startAfter(legacyRoomPageCursors.at(-1)));
  constraints.push(limit(legacyRoomPageSize));
  legacyRoomsUnsub = onSnapshot(query(collection(db, "legacyRoomQuarantine"), ...constraints), snapshot => {
    state.legacyRooms = records(snapshot); legacyRoomPageLast = snapshot.docs.at(-1) ?? null;
    pendingLegacyRoomActions.clear(); renderLegacyRooms();
    $("legacy-rooms-older").hidden = snapshot.size < legacyRoomPageSize;
    $("legacy-rooms-newer").hidden = legacyRoomPageCursors.length === 0;
  }, () => setStatus("Could not load legacy-room manual reviews.", true));
}

function renderReports(intendedFocus) {
  const activeFocus = intendedFocus || reportFocus();
  const reports = filterModerationCases(state.moderationCases, { filter: reportFilter });
  $("admin-reports").replaceChildren(...(reports.length ? reports.map(renderReportRow) : [empty("No reported material matches this view.")]));
  restoreReportFocus(activeFocus);
}

function renderContent() {
  const needle = $("admin-content-search").value.trim().toLowerCase(), type = $("admin-content-type").value;
  const content = [...state.posts.map(entry => ({ ...entry, type: "timeline" })), ...state.communityPosts.map(entry => ({ ...entry, type: "community" }))]
    .filter(entry => (type === "all" || entry.type === type) && (!needle || String(entry.username || "").toLowerCase().includes(needle) || String(entry.content || "").toLowerCase().includes(needle)))
    .sort((left, right) => (timestampMillis(right.createdAt) ?? 0) - (timestampMillis(left.createdAt) ?? 0)).slice(0, 200);
  $("admin-posts").replaceChildren(...(content.length ? content.map(entry => {
    const row = create("article", undefined, "admin-row"), info = create("div"), actions = create("div", undefined, "admin-actions");
    info.append(create("strong", `@${entry.username || "Unknown user"} · ${entry.type === "community" ? entry.category || "Community" : "Timeline"}`), create("small", String(entry.content || "Photo post").slice(0, 240)), create("small", formatDate(entry.createdAt)));
    const open = create("a", "View", "admin-action nav-button"); open.href = entry.type === "community" ? "community.html" : `timeline.html#post-${entry.id}`;
    const deletion = generalContentDeletionPayloads({ id: entry.id, type: entry.type, authorId: entry.authorId, requestedBy: adminUid, requestedAt: serverTimestamp() });
    const existingCase = state.moderationCases.find(item => item.id === deletion.id), existingAction = state.moderationActions.get(deletion.id);
    const writeMode = generalContentDeletionWriteMode({ caseExists: Boolean(existingCase), actionExists: Boolean(existingAction) });
    const queued = existingCase?.status === "deleteQueued" || ["queued", "processing", "failed"].includes(existingAction?.status);
    const remove = create("button", queued ? "Deletion queued" : writeMode === "blocked" ? "Review moderation case" : "Delete", "admin-action danger");
    remove.type = "button"; remove.disabled = queued || writeMode === "blocked" || !moderationControlsReady();
    remove.onclick = async () => {
      if (!moderationControlsReady()) { setStatus("Moderation actions are paused until the trusted service is healthy.", true); return; }
      if (!window.confirm("Queue permanent deletion of this public content and all descendants?")) return;
      remove.disabled = true; remove.textContent = "Queueing deletion…";
      try {
        const timestamp = serverTimestamp();
        const payloads = generalContentDeletionPayloads({ id: entry.id, type: entry.type, authorId: entry.authorId, requestedBy: adminUid, requestedAt: timestamp });
        if (writeMode === "action-only") await setDoc(doc(db, "moderationActions", payloads.id), payloads.action);
        else {
          const batch = writeBatch(db);
          batch.set(doc(db, "moderationCases", payloads.id), payloads.moderationCase);
          batch.set(doc(db, "moderationActions", payloads.id), payloads.action);
          await batch.commit();
        }
        remove.textContent = "Deletion queued"; setStatus("Permanent content deletion queued. The trusted processor will remove descendants.");
      } catch { setStatus("Could not queue that content deletion.", true); remove.textContent = "Delete"; remove.disabled = false; }
    };
    actions.append(open, remove); row.append(info, actions); return row;
  }) : [empty("No public content matches this search.")]));
}

const barRows = (host, items, total) => host.replaceChildren(...items.map(([label, count]) => {
  const row = create("div", undefined, "breakdown-row"), head = create("div"), track = create("div", undefined, "breakdown-track"), bar = create("i");
  head.append(create("span", label), create("strong", `${count} · ${pct(count, total)}%`)); bar.style.width = `${pct(count, total)}%`; track.append(bar); row.append(head, track); return row;
}));
const healthRow = (label, value, tone = "good") => { const row = create("div", undefined, `health-row ${tone}`); row.append(create("span", label), create("strong", String(value))); return row; };
const rankRow = (rank, label, detail, href) => { const row = create(href ? "a" : "div", undefined, "rank-row"); if (href) row.href = href; row.append(create("b", String(rank)), (() => { const text = create("span"); text.append(create("strong", label), create("small", detail)); return text; })()); return row; };

function renderAnalytics() {
  const days = Array.from({ length: 14 }, (_, index) => new Date(Date.now() - (13 - index) * 86400000).toISOString().slice(0, 10));
  const values = days.map(day => ({ day, views: state.views.find(entry => entry.id === day)?.views || 0, users: state.users.filter(user => new Date(timestampMillis(user.createdAt) || 0).toISOString().slice(0, 10) === day).length }));
  const max = Math.max(1, ...values.flatMap(value => [value.views, value.users]));
  $("growth-chart").replaceChildren(...values.map(value => {
    const column = create("div", undefined, "chart-day"), bars = create("div", undefined, "chart-bars"), views = create("i", undefined, "views"), users = create("i", undefined, "users");
    column.setAttribute("role", "group"); column.setAttribute("aria-label", `${value.day}: ${value.views} page views and ${value.users} new users`);
    views.setAttribute("aria-hidden", "true"); users.setAttribute("aria-hidden", "true"); views.style.height = `${Math.max(3, value.views / max * 100)}%`; users.style.height = `${Math.max(3, value.users / max * 100)}%`;
    bars.append(views, users); column.append(bars, create("small", value.day.slice(5)), create("span", `${value.views}/${value.users}`, "chart-value")); return column;
  }));
  const categories = [["Timeline posts", state.posts.length], ["Community posts", state.communityPosts.length], ["Comments", state.comments.length], ["Reactions", state.reactions.length]];
  barRows($("category-breakdown"), categories, categories.reduce((sum, [, count]) => sum + count, 0));
  const reactionNames = { heart: "❤️ Heart", middle_finger: "🖕 Middle finger", laugh: "😂 Laugh", sad: "😢 Sad" };
  const reactions = Object.entries(reactionNames).map(([type, label]) => [label, state.reactions.filter(entry => entry.type === type).length]);
  barRows($("reaction-breakdown"), reactions, state.reactions.length);
  const activity = activityByUser(), usernameFor = uid => state.users.find(user => user.id === uid)?.username || "Unknown user";
  $("top-users").replaceChildren(...[...activity.entries()].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([uid, score], index) => rankRow(index + 1, `@${usernameFor(uid)}`, `${score} activity points`, `profile.html?uid=${encodeURIComponent(uid)}`)));
  const engagedPosts = state.posts.map(entry => ({ entry, score: state.comments.filter(comment => comment.parentId === entry.id).length + state.reactions.filter(reaction => reaction.parentId === entry.id).length })).sort((left, right) => right.score - left.score).slice(0, 8);
  $("top-posts").replaceChildren(...engagedPosts.map(({ entry, score }, index) => rankRow(index + 1, `@${entry.username || "Unknown user"}`, `${score} interactions · ${String(entry.content || "Photo post").slice(0, 55)}`, `timeline.html#post-${entry.id}`)));
  const originals = state.posts.filter(entry => entry.type !== "repost").length, reposts = state.posts.length - originals, photos = state.posts.filter(entry => entry.imageData).length;
  const activeRooms = state.rooms.filter(entry => entry.moderationState === "visible"
    && entry.cleanupState !== "closing" && (timestampMillis(entry.expiresAt) ?? 0) > Date.now()).length;
  $("community-pulse").replaceChildren(healthRow("Original posts", originals), healthRow("Reposts", reposts), healthRow("Photo posts", photos), healthRow("Rooms active now", activeRooms), healthRow("Circles used for posts", `${pct(new Set(state.communityPosts.map(entry => entry.circleId).filter(Boolean)).size, state.circles.length)}%`), healthRow("Average circle size", (state.members.length / Math.max(1, state.circles.length)).toFixed(1)));
  const missingActivity = state.users.filter(user => timestampMillis(user.lastActiveAt) === null).length, failedJobs = [...state.jobs.values()].filter(job => job.data?.status === "failed").length;
  $("data-health").replaceChildren(healthRow("Accounts without recorded activity", missingActivity, missingActivity ? "warn" : "good"), healthRow("Deletion jobs needing attention", failedJobs, failedJobs ? "bad" : "good"), healthRow("Public posts shown", state.posts.length + state.communityPosts.length));
  const views = [...state.views].sort((left, right) => right.id.localeCompare(left.id));
  $("admin-views").replaceChildren(...(views.length ? views.map(view => { const row = create("article", undefined, "admin-row"); row.append(create("strong", view.id), create("span", `${view.views || 0} views`)); return row; }) : [empty("No daily view records yet.")]));
  renderProcessorHealth();
}

function renderProcessorHealth() {
  const health = processorHealth(state.processor);
  $("processor-health").textContent = health.kind === "working" ? "Working normally. Permanent deletion is being checked automatically." : health.kind === "delayed" ? "Delayed. The service has not checked in recently; it will keep retrying." : "Not running. Open the recovery page to restore the account deletion service.";
  $("processor-health").className = `status-${health.kind}`;
  const moderationHealth = state.moderationProcessorListenerHealthy
    ? processorHealth(state.moderationProcessor)
    : { kind: "not-running" };
  $("moderation-processor-health").textContent = moderationHealth.kind === "working"
    ? "Working normally. Reported posts and rooms can be reviewed safely."
    : moderationHealth.kind === "delayed"
      ? "Delayed. Reported-material actions are paused until the service checks in."
      : "Unavailable. Reported-material actions are paused. Open the recovery page to restart the service.";
  $("moderation-processor-health").className = `status-${moderationHealth.kind}`;
}

function renderAll() { renderMetrics(); renderUsers(); renderReports(); renderContent(); renderAnalytics(); }
function updateDialogConfirmation() { $("delete-account-confirm").disabled = !canConfirmDeletion({ typedUsername: $("delete-account-confirmation").value, targetUsername: dialogTarget?.username, blocked: !dialogState.open || dialogState.submitting || state.jobs.has(dialogTarget?.id) }); }
function openDeletionDialog(user, trigger) {
  if (state.jobs.has(user.id)) { setStatus("That account is already locked for permanent deletion.", true); return; }
  dialogTarget = user; dialogTrigger = { node: trigger, focusKey: trigger.dataset.focusKey }; dialogState = { open: true, targetUid: user.id, submitting: false };
  $("delete-account-target").textContent = `Account: @${user.username || "Unknown user"}`; $("delete-account-confirmation").value = ""; $("delete-account-dialog-status").textContent = "";
  $("delete-account-dialog").showModal(); $("delete-account-confirmation").focus(); updateDialogConfirmation();
}
function closeDeletionDialog(message, error = false) {
  dialogState = { ...dialogState, open: false, submitting: false };
  if ($("delete-account-dialog").open) $("delete-account-dialog").close();
  if (message) setStatus(message, error);
}
function closeForConfirmedJob(job) {
  const next = deletionDialogJobTransition(dialogState, job);
  dialogState = next;
  if (!next.open) closeDeletionDialog(next.feedback, job.data?.status === "failed");
}
async function queueDeletion() {
  if (!dialogTarget || dialogState.submitting || !canConfirmDeletion({ typedUsername: $("delete-account-confirmation").value, targetUsername: dialogTarget.username, blocked: state.jobs.has(dialogTarget.id) })) return;
  dialogState = { ...dialogState, submitting: true }; $("delete-account-confirm").disabled = true; $("delete-account-dialog-status").textContent = "Queueing permanent deletion…";
  try {
    const timestamp = serverTimestamp(), payloads = adminDeletionQueuePayloads({ targetUid: dialogTarget.id, requesterUid: adminUid, timestamp }), batch = writeBatch(db);
    batch.update(doc(db, "users", dialogTarget.id), payloads.profile); batch.set(doc(db, "adminDeletionJobs", dialogTarget.id), payloads.job); await batch.commit();
    closeDeletionDialog("Account locked. Permanent deletion queued.");
  } catch {
    const next = queueFailureDialogTransition(dialogState, jobFor(dialogTarget.id));
    dialogState = next;
    if (!next.open) { closeDeletionDialog(next.feedback, jobFor(dialogTarget.id)?.data?.status === "failed"); return; }
    if (!$("delete-account-dialog").open) $("delete-account-dialog").showModal();
    $("delete-account-dialog-status").textContent = next.feedback; updateDialogConfirmation();
  }
}

function handleJobSnapshot(snapshot) {
  state.jobs = new Map(snapshot.docs.map(entry => [entry.id, deletionJobRecord(entry.id, entry.data(), entry.metadata.hasPendingWrites)]));
  const job = dialogTarget ? jobFor(dialogTarget.id) : null;
  if (dialogState.open && job) {
    if (dialogState.submitting && job.hasPendingWrites) $("delete-account-dialog-status").textContent = "Waiting for the deletion request to be confirmed…";
    else closeForConfirmedJob(job);
  }
  renderMetrics(); renderUsers(); renderReports(); renderAnalytics(); updateDialogConfirmation();
}
function observe(ref, key, onData, transform = records) {
  unsubs.push(onSnapshot(ref, snapshot => { state[key] = transform(snapshot); onData(); }, () => setStatus("Could not load live dashboard data.", true)));
}
function startLiveData() {
  if (!pageActive || !adminUid || listenersStarted) return;
  listenersStarted = true;
  observe(collection(db, "users"), "users", () => { renderMetrics(); renderUsers(); renderReports(); renderAnalytics(); });
  observe(query(collection(db, "posts"), orderBy("createdAt", "desc")), "posts", () => { renderMetrics(); renderContent(); renderAnalytics(); });
  observe(query(collection(db, "communityPosts"), orderBy("createdAt", "desc")), "communityPosts", () => { renderMetrics(); renderContent(); renderAnalytics(); });
  observe(collection(db, "pageViews"), "views", renderAnalytics); observe(collectionGroup(db, "comments"), "comments", renderAnalytics); observe(collectionGroup(db, "reactions"), "reactions", renderAnalytics);
  observe(collection(db, "follows"), "follows", renderAnalytics); observe(collection(db, "circles"), "circles", renderAnalytics); observe(collection(db, "circleMembers"), "members", renderAnalytics);
  observe(collection(db, "rooms"), "rooms", renderAnalytics); observe(collection(db, "communityVotes"), "votes", () => { renderMetrics(); renderAnalytics(); });
  startReportQueue();
  startLegacyRoomQueue();
  unsubs.push(onSnapshot(collection(db, "adminDeletionJobs"), handleJobSnapshot, () => setStatus("Could not load live deletion status.", true)));
  unsubs.push(onSnapshot(doc(db, "system", "deletionProcessor"), snapshot => { state.processor = snapshot.exists() ? snapshot.data() : null; renderProcessorHealth(); }, () => { state.processor = null; renderProcessorHealth(); }));
  unsubs.push(onSnapshot(doc(db, "system", "moderationProcessor"), { includeMetadataChanges: true }, snapshot => {
    state.moderationProcessorListenerHealthy = snapshot.metadata.fromCache !== true;
    state.moderationProcessor = snapshot.exists() ? snapshot.data() : null;
    renderProcessorHealth(); renderReports(); renderContent(); renderLegacyRooms();
  }, () => {
    state.moderationProcessorListenerHealthy = false; state.moderationProcessor = null;
    renderProcessorHealth(); renderReports(); renderContent(); renderLegacyRooms();
  }));
  heartbeatTimer = window.setInterval(() => { renderProcessorHealth(); renderReports(); renderContent(); renderLegacyRooms(); }, 60 * 1000);
}
function stopLiveData() { while (unsubs.length) unsubs.pop()(); reportCasesUnsub?.(); reportCasesUnsub = null; legacyRoomsUnsub?.(); legacyRoomsUnsub = null; for (const unsubscribe of reportActionUnsubs.values()) unsubscribe(); reportActionUnsubs.clear(); for (const id of loadedModerationEvidence.keys()) evictModerationEvidence(id); for (const id of loadedRoomTranscripts.keys()) evictRoomTranscript(id); if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer); heartbeatTimer = null; state.moderationProcessorListenerHealthy = false; listenersStarted = false; }

$("admin-user-search").oninput = renderUsers; $("admin-report-status").onchange = () => { reportFilter = $("admin-report-status").value; reportPageCursors.length = 0; startReportQueue(); }; $("admin-reports-load-more").onclick = () => { if (reportPageLast) { reportPageCursors.push(reportPageLast); startReportQueue(); } }; $("admin-reports-previous").onclick = () => { reportPageCursors.pop(); startReportQueue(); }; $("admin-content-search").oninput = renderContent; $("admin-content-type").onchange = renderContent; $("metric-window").onchange = () => { renderMetrics(); renderAnalytics(); };
$("legacy-rooms-older").onclick = () => { if (legacyRoomPageLast) { legacyRoomPageCursors.push(legacyRoomPageLast); startLegacyRoomQueue(); } };
$("legacy-rooms-newer").onclick = () => { legacyRoomPageCursors.pop(); startLegacyRoomQueue(); };
document.querySelectorAll("[data-user-filter]").forEach(button => { button.onclick = () => { userFilter = button.dataset.userFilter; document.querySelectorAll("[data-user-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button))); renderUsers(); }; });
$("refresh-admin").onclick = () => { renderAll(); setStatus("Dashboard recalculated from live data."); }; $("admin-sign-out").onclick = async () => {
  await exitAuthenticatedSession({
    user: adminUser,
    stopListeners: stopLiveData,
    redirect: () => location.replace("index.html")
  });
};
$("delete-account-confirmation").oninput = updateDialogConfirmation; $("delete-account-confirm").onclick = queueDeletion;
$("delete-account-dialog").addEventListener("close", () => { const fallback = dialogTrigger?.focusKey?.startsWith("report-") ? $("admin-report-status") : $("admin-user-search"), trigger = dialogTrigger?.node?.isConnected ? dialogTrigger.node : controlByFocusKey(dialogTrigger?.focusKey); (trigger || fallback).focus(); dialogTrigger = null; });
window.addEventListener("pagehide", () => { pageActive = false; stopLiveData(); }); window.addEventListener("pageshow", () => { pageActive = true; startLiveData(); });

onAuthStateChanged(auth, async user => {
  if (!user) {
    await exitAfterAuthLoss({ redirect: () => location.replace("index.html") });
    return;
  }
  const profile = await getDoc(doc(db, "users", user.uid)), profileData = profile.exists() ? profile.data() : null, username = profileData?.username || "";
  const reservation = isProtectedAdministrator(username) ? await getDoc(doc(db, "usernames", normalizeUsername(username))) : null;
  const authorized = !profileData?.banned && reservation?.exists() && reservation.data().uid === user.uid && reservation.data().username === username;
  if (!authorized) { location.replace("timeline.html"); return; }
  adminUid = user.uid; adminUser = user; $("admin-identity").textContent = `Signed in as @${username}`;
  $("admin-authenticator-start").disabled = false;
  if (multiFactor(user).enrolledFactors.some(factor => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID)) {
    $("admin-authenticator-start").hidden = true;
    setAuthenticatorStatus("Authenticator protection is enabled on this administrator account.");
  }
  void recordPageActivity({ surface: "admin", profile: profileData, user, db, firestore: { doc, updateDoc, serverTimestamp }, isAuthorizedAdmin: authorized }); startLiveData();
});
