import { auth, db } from "./firebase-config.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { adminDeletionQueuePayloads, canAdminSetBanned, canQueueAdminDeletion, isProtectedAdministrator, normalizeUsername } from "./admin-deletion-policy.mjs";
import { canConfirmDeletion, deletionDialogJobTransition, deletionJobRecord, filterPendingReports, filterUsers, markReportsResolved, moderationActionAllowed, moderationDeletionQueuePlan, moderationDeletionState, moderationResolutionPlan, processorHealth, queueFailureDialogTransition, reportedPostRows, reportedRoomRows, resolveUserFocus, sortInactiveUsers, statusForUser, timestampMillis } from "./admin-dashboard-policy.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { Timestamp, collection, collectionGroup, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, startAfter, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { users: [], posts: [], communityPosts: [], reports: [], views: [], comments: [], reactions: [], follows: [], circles: [], members: [], rooms: [], votes: [], jobs: new Map(), moderationJobs: new Map(), roomEvidenceByRoom: new Map(), moderationJobObservationHealthy: false, processor: null, moderationProcessor: null };
const unsubs = [];
const roomEvidenceUnsubs = new Map();
let adminUid = "", adminUser = null, userFilter = "all", reportFilter = "all", pageActive = true, listenersStarted = false, heartbeatTimer = null;
let moderationJobListenerReady = false, moderationJobLoadVersion = 0;
let activeModerationJobs = new Map();
let dialogState = { open: false, targetUid: "", submitting: false }, dialogTarget = null, dialogTrigger = null;
const moderationPending = new Set();

const setStatus = (message, error = false) => { $("admin-status").textContent = message; $("admin-status").style.color = error ? "#fca5a5" : ""; };
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

function renderContent() {
  const needle = $("admin-content-search").value.trim().toLowerCase(), type = $("admin-content-type").value;
  const content = [...state.posts.map(entry => ({ ...entry, type: "timeline" })), ...state.communityPosts.map(entry => ({ ...entry, type: "community" }))]
    .filter(entry => (type === "all" || entry.type === type) && (!needle || String(entry.username || "").toLowerCase().includes(needle) || String(entry.content || "").toLowerCase().includes(needle)))
    .sort((left, right) => (timestampMillis(right.createdAt) ?? 0) - (timestampMillis(left.createdAt) ?? 0)).slice(0, 200);
  $("admin-posts").replaceChildren(...(content.length ? content.map(entry => {
    const row = create("article", undefined, "admin-row"), info = create("div"), actions = create("div", undefined, "admin-actions");
    info.append(create("strong", `@${entry.username || "Unknown user"} · ${entry.type === "community" ? entry.category || "Community" : "Timeline"}`), create("small", String(entry.content || "Photo post").slice(0, 240)), create("small", formatDate(entry.createdAt)));
    const open = create("a", "View", "admin-action nav-button"); open.href = entry.type === "community" ? "community.html" : `timeline.html#post-${entry.id}`;
    const remove = create("button", "Delete", "admin-action danger"); remove.type = "button";
    remove.onclick = async () => { if (!window.confirm("Delete this public content? This cannot be undone.")) return; remove.disabled = true; try { await deleteDoc(doc(db, entry.type === "community" ? "communityPosts" : "posts", entry.id)); setStatus("Content deleted."); } catch { setStatus("Could not delete that content.", true); remove.disabled = false; } };
    actions.append(open, remove); row.append(info, actions); return row;
  }) : [empty("No public content matches this search.")]));
}

const moderationKey = report => `${report.targetType}_${report.targetId}`;
const reportTypeLabel = report => report.targetType === "room" ? "Temporary room" : report.targetType === "communityPost" ? "Community post" : "Timeline post";
const moderationStatus = (message, error = false) => {
  $("reported-content-status").textContent = message;
  $("reported-content-status").style.color = error ? "#fca5a5" : "";
};

function reportRowElement(row) {
  const { report, target } = row, key = moderationKey(report), deletion = moderationDeletionState(state.moderationJobs, report);
  const deletionPending = deletion?.pending === true, busy = moderationPending.has(key) || deletionPending;
  const article = create("article", undefined, `admin-row reported-row${busy ? " is-pending" : ""}`), details = create("div", undefined, "reported-details");
  const meta = create("div", undefined, "reported-meta"), type = create("span", reportTypeLabel(report), `reported-badge${report.targetType === "room" ? " room" : ""}`);
  meta.append(type, create("span", `Reason: ${report.reason || "Not provided"}`, "reported-badge"));
  details.append(meta, create("strong", row.preview), create("p", `Reported by @${row.reporterUsername} · Owner @${row.ownerUsername}`, "reported-context"), create("p", `Reported ${formatDate(report.createdAt)}`, "reported-context"));
  if (report.targetType === "room") {
    details.append(create("p", "Messages are preserved for administrator review. Expiration is paused while this room is reported.", "reported-warning"));
    const messages = create("ul", undefined, "reported-messages");
    row.messages.forEach(message => {
      const item = create("li");
      item.append(create("strong", `${message.tempName || "Anonymous"}: `), document.createTextNode(String(message.text || "")), create("small", formatDate(message.createdAt)));
      messages.append(item);
    });
    if (row.messages.length) {
      details.append(messages, create("p", `Showing ${row.messages.length} of ${row.evidenceTotalCount} preserved messages.`, "reported-context"));
      if (row.evidenceHasMore) {
        const showMore = create("button", row.evidenceLoading ? "Loading messages…" : "Show more messages", "admin-action");
        showMore.type = "button";
        showMore.disabled = row.evidenceLoading;
        showMore.onclick = () => loadMoreRoomEvidence(report.targetId);
        details.append(showMore);
      }
    } else details.append(create("p", row.evidenceLoading ? "Loading preserved messages…" : "No preserved messages in this room. Showing 0 of 0.", "reported-context"));
    if (row.evidenceError) details.append(create("p", "Some preserved messages could not be loaded. Try again.", "reported-warning"));
  } else {
    const expiresAt = timestampMillis(target?.expiresAt);
    details.append(create("p", row.preview, "reported-preview"));
    if (row.imagePreview.kind === "image") {
      const image = create("img");
      image.src = row.imagePreview.src;
      image.alt = row.imagePreview.alt;
      image.loading = "lazy";
      image.referrerPolicy = row.imagePreview.referrerPolicy;
      image.className = "reported-image";
      details.append(image);
    } else if (row.imagePreview.kind === "placeholder") details.append(create("p", row.imagePreview.text, "reported-image-placeholder"));
    if (expiresAt !== null && expiresAt <= Date.now()) details.append(create("p", "This post has expired. Restoring resolves the report but does not republish it.", "reported-warning"));
  }
  const live = create("p", deletionPending
    ? deletion.label
    : busy
      ? "Saving this decision…"
      : !row.targetExists ? "The reported target is unavailable, so no action can be completed safely." : "", "reported-row-status");
  live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); details.append(live);
  const actions = create("div", undefined, "admin-actions");
  const templateId = report.targetType === "room" ? "reported-room-actions" : "reported-post-actions";
  actions.append($(templateId).content.cloneNode(true));
  actions.querySelectorAll("[data-moderation-action]").forEach(button => {
    const action = button.dataset.moderationAction;
    button.disabled = !row.targetExists || !moderationActionAllowed({
      status: report.status,
      targetType: report.targetType,
      action,
      blocked: busy || !state.moderationJobObservationHealthy
    });
    button.dataset.focusKey = focusKey("report", action, report.id);
    button.onclick = () => performModerationAction(row, action);
  });
  article.append(details, actions); return article;
}

function renderReportedContent() {
  const pending = filterPendingReports(state.reports);
  $("reported-count").textContent = `${pending.length} pending report${pending.length === 1 ? "" : "s"}`;
  const joined = [
    ...reportedPostRows({ reports: pending, posts: state.posts, communityPosts: state.communityPosts, users: state.users }),
    ...reportedRoomRows({ reports: pending, rooms: state.rooms, roomEvidenceByRoom: state.roomEvidenceByRoom, users: state.users })
  ];
  const rowsById = new Map(joined.map(row => [row.report.id, row]));
  const visible = pending
    .filter(report => reportFilter === "all" || (reportFilter === "room" ? report.targetType === "room" : report.targetType !== "room"))
    .map(report => rowsById.get(report.id)).filter(Boolean);
  $("reported-content").replaceChildren(...(visible.length ? visible.map(reportRowElement) : [create("p", pending.length ? "No pending reports match this filter." : "No content is waiting for review.", "admin-note reported-empty")]));
  const pendingDeletions = pending.filter(report => moderationDeletionState(state.moderationJobs, report)?.pending).length;
  if (pendingDeletions) moderationStatus(`${pendingDeletions} deletion${pendingDeletions === 1 ? "" : "s"} pending trusted processor completion.`);
  else if (!pending.length) moderationStatus("The moderation queue is clear.");
  else if (!state.moderationJobObservationHealthy) moderationStatus("Moderation deletion status is unavailable. Actions are locked until the live safety check recovers.", true);
  else if (![...moderationPending].length) moderationStatus("Live queue ready. Review each report before taking action.");
}

const roomEvidenceQuery = roomId => query(
  collection(db, "roomMessages"),
  where("roomId", "==", roomId),
  orderBy("createdAt", "asc")
);

const mergeEvidenceMessages = (current, incoming) => {
  const merged = new Map((current ?? []).map(message => [message.id, message]));
  incoming.forEach(message => merged.set(message.id, message));
  return [...merged.values()].sort((left, right) => (timestampMillis(left.createdAt) ?? 0) - (timestampMillis(right.createdAt) ?? 0)
    || String(left.id).localeCompare(String(right.id)));
};

async function refreshRoomEvidenceCount(roomId) {
  const evidence = state.roomEvidenceByRoom.get(roomId);
  if (!evidence) return;
  try {
    const count = await getCountFromServer(roomEvidenceQuery(roomId));
    const current = state.roomEvidenceByRoom.get(roomId);
    if (!current) return;
    current.totalCount = Math.max(current.messages.length, count.data().count);
    current.hasMore = current.messages.length < current.totalCount;
  } catch {
    const current = state.roomEvidenceByRoom.get(roomId);
    if (current) {
      current.totalCount = Math.max(current.totalCount ?? 0, current.messages.length);
      current.hasMore = current.hasMore || current.messages.length >= 12;
    }
  }
  renderReportedContent();
}

function startRoomEvidence(roomId) {
  if (roomEvidenceUnsubs.has(roomId)) return;
  state.roomEvidenceByRoom.set(roomId, {
    messages: [], totalCount: 0, hasMore: false, loading: true, error: null, cursor: null
  });
  const firstPage = query(roomEvidenceQuery(roomId), limit(12));
  const unsubscribe = onSnapshot(firstPage, snapshot => {
    const current = state.roomEvidenceByRoom.get(roomId);
    if (!current) return;
    const firstMessages = records(snapshot);
    current.messages = mergeEvidenceMessages(current.messages.slice(12), firstMessages);
    current.cursor = snapshot.docs.at(-1) ?? null;
    current.loading = false;
    current.error = null;
    current.hasMore = snapshot.size === 12 && current.messages.length < Math.max(current.totalCount, current.messages.length + 1);
    renderReportedContent();
    void refreshRoomEvidenceCount(roomId);
  }, error => {
    const current = state.roomEvidenceByRoom.get(roomId);
    if (!current) return;
    current.loading = false;
    current.error = error;
    renderReportedContent();
  });
  roomEvidenceUnsubs.set(roomId, unsubscribe);
}

function syncRoomEvidence() {
  const needed = new Set(filterPendingReports(state.reports)
    .filter(report => report.targetType === "room")
    .map(report => report.targetId));
  for (const [roomId, unsubscribe] of roomEvidenceUnsubs) {
    if (needed.has(roomId)) continue;
    unsubscribe();
    roomEvidenceUnsubs.delete(roomId);
    state.roomEvidenceByRoom.delete(roomId);
  }
  needed.forEach(startRoomEvidence);
}

async function loadMoreRoomEvidence(roomId) {
  const evidence = state.roomEvidenceByRoom.get(roomId);
  if (!evidence || evidence.loading || !evidence.cursor) return;
  evidence.loading = true;
  evidence.error = null;
  renderReportedContent();
  try {
    const page = await getDocs(query(roomEvidenceQuery(roomId), startAfter(evidence.cursor), limit(12)));
    evidence.messages = mergeEvidenceMessages(evidence.messages, records(page));
    evidence.cursor = page.docs.at(-1) ?? evidence.cursor;
    evidence.hasMore = page.size === 12 && evidence.messages.length < Math.max(evidence.totalCount, evidence.messages.length + 1);
  } catch (error) {
    evidence.error = error;
  } finally {
    evidence.loading = false;
    renderReportedContent();
  }
}

async function removeResolvedReport(report) {
  await deleteDoc(doc(db, "reports", report.id));
  return true;
}

const targetReports = async report => records(await getDocs(query(
  collection(db, "reports"),
  where("targetType", "==", report.targetType),
  where("targetId", "==", report.targetId)
)));

async function performModerationAction(row, action) {
  const { report } = row, key = moderationKey(report), destructive = action === "delete-post" || action === "delete-room";
  if (moderationPending.has(key) || !state.moderationJobObservationHealthy
    || !moderationActionAllowed({ status: report.status, targetType: report.targetType, action }) || !row.targetExists) return;
  if (destructive && !window.confirm(`Permanently delete this ${reportTypeLabel(report).toLowerCase()} and its dependent records? This cannot be undone.`)) return;
  moderationPending.add(key); moderationStatus("Saving the moderation decision…"); renderReportedContent();
  try {
    const currentReports = await targetReports(report);
    for (const resolvedReport of currentReports.filter(candidate => candidate.status === "resolved")) {
      try { await removeResolvedReport(resolvedReport); }
      catch { throw new Error("A previous resolved report must be cleaned up before this target can be reviewed again."); }
    }
    const timestamp = serverTimestamp();
    const pendingTargetReports = currentReports
      .filter(candidate => candidate.status === "pending")
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    const anchorReport = pendingTargetReports.find(candidate => candidate.id === report.id) ?? pendingTargetReports[0];
    if (!anchorReport) throw new Error("No pending report remains for this target.");
    if (destructive) {
      const deletion = moderationDeletionQueuePlan({ report: anchorReport, adminId: adminUid, timestamp });
      const batch = writeBatch(db);
      batch.set(doc(db, "moderationDeletionJobs", deletion.jobId), deletion.job);
      await batch.commit();
      state.moderationJobs.set(deletion.jobId, { id: deletion.jobId, data: deletion.job });
      moderationStatus("Deletion Pending. The trusted processor will remove all dependent records and reports.");
      return;
    }
    const plan = moderationResolutionPlan({
      report: anchorReport,
      reports: pendingTargetReports,
      action,
      adminId: adminUid,
      timestamp,
      expiresAt: action === "restore-room" ? Timestamp.fromMillis(Date.now() + 86_400_000) : undefined
    });
    const batch = writeBatch(db), targetRef = doc(db, plan.targetCollection, report.targetId);
    batch.set(doc(collection(db, "moderationActions"), plan.markerId), plan.marker);
    plan.reportResolutions.forEach(resolution => batch.update(doc(db, "reports", resolution.id), resolution.data));
    batch.update(targetRef, plan.target);
    await batch.commit();
    const resolvedIds = plan.reportResolutions.map(resolution => resolution.id);
    state.reports = markReportsResolved(state.reports, resolvedIds);
    try {
      for (const resolvedId of resolvedIds) await removeResolvedReport({ id: resolvedId });
      setStatus("Report resolved and content restored.");
    } catch {
      setStatus("The decision was saved. Scheduled cleanup will remove its resolved report before this target can be reviewed again.");
    }
  } catch (error) {
    setStatus(error?.message || "Could not save that moderation decision. No target change was made.", true);
  } finally {
    moderationPending.delete(key); renderReportedContent();
  }
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
  const activeRooms = state.rooms.filter(entry => entry.moderationStatus === "active"
    && ((timestampMillis(entry.expiresAt) ?? Infinity) > Date.now())).length;
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
  const moderationHealth = processorHealth(state.moderationProcessor);
  $("moderation-processor-health").textContent = moderationHealth.kind === "working"
    ? "Working normally. Reported-content deletions are being checked automatically."
    : moderationHealth.kind === "delayed"
      ? "Delayed. Reported-content deletion will keep retrying on the shared worker."
      : "Not running. Open the moderation recovery page to restart the shared deletion worker.";
  $("moderation-processor-health").className = `status-${moderationHealth.kind}`;
}

function renderAll() { renderReportedContent(); renderMetrics(); renderUsers(); renderContent(); renderAnalytics(); }
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
  renderMetrics(); renderUsers(); renderAnalytics(); updateDialogConfirmation();
}
function observe(ref, key, onData, transform = records) {
  unsubs.push(onSnapshot(ref, snapshot => { state[key] = transform(snapshot); onData(); }, () => setStatus("Could not load live dashboard data.", true)));
}

async function refreshModerationJobBarriers() {
  if (!moderationJobListenerReady) return;
  const version = ++moderationJobLoadVersion;
  state.moderationJobObservationHealthy = false;
  renderReportedContent();
  try {
    const jobs = new Map(activeModerationJobs);
    const keys = [...new Set(filterPendingReports(state.reports).map(moderationKey))]
      .filter(key => !jobs.has(key));
    const snapshots = await Promise.all(keys.map(async key => ({
      key,
      snapshot: await getDoc(doc(db, "moderationDeletionJobs", key))
    })));
    if (version !== moderationJobLoadVersion) return;
    snapshots.forEach(({ key, snapshot }) => {
      if (snapshot.exists()) jobs.set(key, { id: key, data: snapshot.data() });
    });
    state.moderationJobs = jobs;
    state.moderationJobObservationHealthy = true;
  } catch {
    if (version !== moderationJobLoadVersion) return;
    state.moderationJobs = new Map(activeModerationJobs);
    state.moderationJobObservationHealthy = false;
  }
  renderReportedContent();
}

function startLiveData() {
  if (!pageActive || !adminUid || listenersStarted) return;
  listenersStarted = true;
  observe(collection(db, "users"), "users", () => { renderReportedContent(); renderMetrics(); renderUsers(); renderAnalytics(); });
  observe(query(collection(db, "posts"), orderBy("createdAt", "desc")), "posts", () => { renderReportedContent(); renderMetrics(); renderContent(); renderAnalytics(); });
  observe(query(collection(db, "communityPosts"), orderBy("createdAt", "desc")), "communityPosts", () => { renderReportedContent(); renderMetrics(); renderContent(); renderAnalytics(); });
  observe(query(collection(db, "reports"), where("status", "==", "pending"), orderBy("createdAt", "desc")), "reports", () => {
    syncRoomEvidence();
    renderReportedContent();
    void refreshModerationJobBarriers();
  });
  unsubs.push(onSnapshot(query(
    collection(db, "moderationDeletionJobs"),
    where("status", "in", ["queued", "failed", "processing"]),
    orderBy("requestedAt", "desc"),
    limit(200)
  ), snapshot => {
    activeModerationJobs = new Map(snapshot.docs.map(entry => [entry.id, { id: entry.id, data: entry.data() }]));
    moderationJobListenerReady = true;
    void refreshModerationJobBarriers();
  }, () => {
    moderationJobListenerReady = false;
    state.moderationJobObservationHealthy = false;
    moderationStatus("Could not load live moderation deletion status. Actions are locked.", true);
    renderReportedContent();
  }));
  observe(collection(db, "pageViews"), "views", renderAnalytics); observe(collectionGroup(db, "comments"), "comments", renderAnalytics); observe(collectionGroup(db, "reactions"), "reactions", renderAnalytics);
  observe(collection(db, "follows"), "follows", renderAnalytics); observe(collection(db, "circles"), "circles", renderAnalytics); observe(collection(db, "circleMembers"), "members", renderAnalytics);
  observe(collection(db, "rooms"), "rooms", () => { renderReportedContent(); renderAnalytics(); }); observe(collection(db, "communityVotes"), "votes", () => { renderMetrics(); renderAnalytics(); });
  unsubs.push(onSnapshot(collection(db, "adminDeletionJobs"), handleJobSnapshot, () => setStatus("Could not load live deletion status.", true)));
  unsubs.push(onSnapshot(doc(db, "system", "deletionProcessor"), snapshot => { state.processor = snapshot.exists() ? snapshot.data() : null; renderProcessorHealth(); }, () => { state.processor = null; renderProcessorHealth(); }));
  unsubs.push(onSnapshot(doc(db, "system", "moderationDeletionProcessor"), snapshot => { state.moderationProcessor = snapshot.exists() ? snapshot.data() : null; renderProcessorHealth(); }, () => { state.moderationProcessor = null; renderProcessorHealth(); }));
  heartbeatTimer = window.setInterval(renderProcessorHealth, 60 * 1000);
}
function stopLiveData() {
  while (unsubs.length) unsubs.pop()();
  for (const unsubscribe of roomEvidenceUnsubs.values()) unsubscribe();
  roomEvidenceUnsubs.clear();
  state.roomEvidenceByRoom.clear();
  moderationJobListenerReady = false;
  state.moderationJobObservationHealthy = false;
  moderationJobLoadVersion += 1;
  if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  listenersStarted = false;
}

$("admin-user-search").oninput = renderUsers; $("admin-content-search").oninput = renderContent; $("admin-content-type").onchange = renderContent; $("metric-window").onchange = () => { renderMetrics(); renderAnalytics(); };
document.querySelectorAll("[data-user-filter]").forEach(button => { button.onclick = () => { userFilter = button.dataset.userFilter; document.querySelectorAll("[data-user-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button))); renderUsers(); }; });
document.querySelectorAll("[data-report-filter]").forEach(button => { button.onclick = () => { reportFilter = button.dataset.reportFilter; document.querySelectorAll("[data-report-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button))); renderReportedContent(); }; });
$("refresh-admin").onclick = () => { renderAll(); setStatus("Dashboard recalculated from live data."); }; $("admin-sign-out").onclick = async () => {
  await exitAuthenticatedSession({
    user: adminUser,
    stopListeners: stopLiveData,
    redirect: () => location.replace("index.html")
  });
};
$("delete-account-confirmation").oninput = updateDialogConfirmation; $("delete-account-confirm").onclick = queueDeletion;
$("delete-account-dialog").addEventListener("close", () => { const fallback = $("admin-user-search"), trigger = dialogTrigger?.node?.isConnected ? dialogTrigger.node : controlByFocusKey(dialogTrigger?.focusKey); (trigger || fallback).focus(); dialogTrigger = null; });
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
  void recordPageActivity({ surface: "admin", profile: profileData, user, db, firestore: { doc, updateDoc, serverTimestamp }, isAuthorizedAdmin: authorized }); startLiveData();
});
