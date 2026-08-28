import { auth, db } from "./firebase-config.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { adminDeletionQueuePayloads, canAdminSetBanned, canQueueAdminDeletion, isProtectedAdministrator, normalizeUsername } from "./admin-deletion-policy.mjs";
import { canConfirmDeletion, deletionDialogJobTransition, deletionJobRecord, filterUsers, processorHealth, queueFailureDialogTransition, resolveUserFocus, sortInactiveUsers, statusForUser, timestampMillis } from "./admin-dashboard-policy.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, collectionGroup, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { users: [], posts: [], communityPosts: [], views: [], comments: [], reactions: [], follows: [], circles: [], members: [], rooms: [], roomMessages: [], votes: [], jobs: new Map(), processor: null };
const unsubs = [];
let adminUid = "", adminUser = null, userFilter = "all", pageActive = true, listenersStarted = false, heartbeatTimer = null;
let dialogState = { open: false, targetUid: "", submitting: false }, dialogTarget = null, dialogTrigger = null;

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
  state.follows.forEach(entry => add(entry.followerId)); state.roomMessages.forEach(entry => add(entry.senderId));
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
  const activeRooms = new Set(state.roomMessages.filter(entry => (timestampMillis(entry.expiresAt) ?? 0) > Date.now()).map(entry => entry.roomId)).size;
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
}

function renderAll() { renderMetrics(); renderUsers(); renderContent(); renderAnalytics(); }
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
function startLiveData() {
  if (!pageActive || !adminUid || listenersStarted) return;
  listenersStarted = true;
  observe(collection(db, "users"), "users", () => { renderMetrics(); renderUsers(); renderAnalytics(); });
  observe(query(collection(db, "posts"), orderBy("createdAt", "desc")), "posts", () => { renderMetrics(); renderContent(); renderAnalytics(); });
  observe(query(collection(db, "communityPosts"), orderBy("createdAt", "desc")), "communityPosts", () => { renderMetrics(); renderContent(); renderAnalytics(); });
  observe(collection(db, "pageViews"), "views", renderAnalytics); observe(collectionGroup(db, "comments"), "comments", renderAnalytics); observe(collectionGroup(db, "reactions"), "reactions", renderAnalytics);
  observe(collection(db, "follows"), "follows", renderAnalytics); observe(collection(db, "circles"), "circles", renderAnalytics); observe(collection(db, "circleMembers"), "members", renderAnalytics);
  observe(collection(db, "rooms"), "rooms", renderAnalytics); observe(collection(db, "roomMessages"), "roomMessages", renderAnalytics); observe(collection(db, "communityVotes"), "votes", () => { renderMetrics(); renderAnalytics(); });
  unsubs.push(onSnapshot(collection(db, "adminDeletionJobs"), handleJobSnapshot, () => setStatus("Could not load live deletion status.", true)));
  unsubs.push(onSnapshot(doc(db, "system", "deletionProcessor"), snapshot => { state.processor = snapshot.exists() ? snapshot.data() : null; renderProcessorHealth(); }, () => { state.processor = null; renderProcessorHealth(); }));
  heartbeatTimer = window.setInterval(renderProcessorHealth, 60 * 1000);
}
function stopLiveData() { while (unsubs.length) unsubs.pop()(); if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer); heartbeatTimer = null; listenersStarted = false; }

$("admin-user-search").oninput = renderUsers; $("admin-content-search").oninput = renderContent; $("admin-content-type").onchange = renderContent; $("metric-window").onchange = () => { renderMetrics(); renderAnalytics(); };
document.querySelectorAll("[data-user-filter]").forEach(button => { button.onclick = () => { userFilter = button.dataset.userFilter; document.querySelectorAll("[data-user-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button))); renderUsers(); }; });
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
