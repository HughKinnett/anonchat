import { auth, db } from "./firebase-config.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { adminDeletionQueuePayloads, canAdminSetBanned, canQueueAdminDeletion, isProtectedAdministrator, normalizeUsername } from "./admin-deletion-policy.mjs";
import { canConfirmDeletion, deletionDialogJobTransition, filterUsers, processorHealth, sortInactiveUsers, statusForUser, timestampMillis } from "./admin-dashboard-policy.mjs";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, collectionGroup, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { users: [], posts: [], communityPosts: [], views: [], comments: [], reactions: [], jobs: new Map(), processor: null };
const unsubs = [];
let adminUid = "", userFilter = "all", pageActive = true, listenersStarted = false, heartbeatTimer = null;
let dialogState = { open: false, targetUid: "" }, dialogTarget = null, dialogTrigger = null;

const setStatus = (message, error = false) => { $("admin-status").textContent = message; $("admin-status").style.color = error ? "#fca5a5" : ""; };
const records = snapshot => snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() }));
const formatDate = value => { const ms = timestampMillis(value); return ms === null ? "Activity not recorded" : new Date(ms).toLocaleString(); };
const create = (name, text, className) => { const node = document.createElement(name); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
const empty = message => create("p", message, "admin-note");
const userOptions = () => ({ now: Date.now(), deletionJobs: state.jobs });
const jobMessage = user => state.jobs.get(user.id)?.status === "failed" ? "Deletion Pending — needs attention" : "Deletion Pending";

function renderMetrics() {
  const options = userOptions();
  const inactive = filterUsers(state.users, { ...options, filter: "inactive" });
  $("metric-users").textContent = state.users.length;
  $("metric-inactive").textContent = inactive.length;
  $("metric-banned").textContent = filterUsers(state.users, { ...options, filter: "banned" }).length;
  $("metric-content").textContent = state.posts.length + state.communityPosts.length;
  $("last-updated").textContent = `Live data updated ${new Date().toLocaleTimeString()}`;
}

function renderUserRow(user) {
  const status = statusForUser(user, userOptions());
  const locked = state.jobs.has(user.id) || ["adminDeletionRequestedAt", "adminDeletionRequestedBy", "adminDeletionStatus"].some(key => key in user);
  const protectedAdmin = isProtectedAdministrator(user.username);
  const row = create("article", undefined, "admin-row");
  const info = create("div");
  const name = create("strong", `@${user.username || "Unknown user"}`);
  const statusLine = create("small", status.kind === "deletion-pending" ? jobMessage(user) : status.label, `user-status status-${status.kind}`);
  const activeLine = create("small", `Last active: ${formatDate(user.lastActiveAt)}`);
  info.append(name, statusLine, activeLine);
  const actions = create("div", undefined, "admin-actions");
  const profile = create("a", "View Profile", "admin-action nav-button"); profile.href = `profile.html?uid=${encodeURIComponent(user.id)}`;
  const ban = create("button", protectedAdmin ? "Protected administrator" : user.banned ? "Unban" : "Ban", `admin-action ${user.banned ? "restore" : "danger"}`); ban.type = "button";
  ban.disabled = protectedAdmin || !canAdminSetBanned({ nextBanned: !user.banned, existingJob: locked, existingQueueState: locked });
  ban.onclick = async () => { ban.disabled = true; try { await updateDoc(doc(db, "users", user.id), { banned: !user.banned }); setStatus(user.banned ? "Account unbanned." : "Account banned."); } catch { setStatus("Could not update that account.", true); renderUsers(); } };
  const remove = create("button", "Delete Account", "admin-action danger"); remove.type = "button";
  remove.disabled = protectedAdmin || !canQueueAdminDeletion({ targetUid: user.id, username: user.username, existingJob: locked, existingQueueState: locked });
  remove.onclick = () => openDeletionDialog(user, remove);
  actions.append(profile, ban, remove); row.append(info, actions); return row;
}

function renderUsers() {
  const options = { ...userOptions(), filter: userFilter, search: $("admin-user-search").value.trim() };
  const users = filterUsers(state.users, options).sort((a, b) => String(a.username || "").localeCompare(String(b.username || "")));
  $("admin-users").replaceChildren(...(users.length ? users.map(renderUserRow) : [empty("No accounts match this view.")]));
  const inactive = sortInactiveUsers(state.users, userOptions());
  $("inactive-users").replaceChildren(...(inactive.length ? inactive.map(renderUserRow) : [empty("No eligible inactive accounts right now.")]));
}

function renderContent() {
  const needle = $("admin-content-search").value.trim().toLowerCase(), type = $("admin-content-type").value;
  const content = [
    ...state.posts.map(entry => ({ ...entry, type: "timeline" })),
    ...state.communityPosts.map(entry => ({ ...entry, type: "community" }))
  ].filter(entry => (type === "all" || entry.type === type) && (!needle || String(entry.username || "").toLowerCase().includes(needle) || String(entry.content || "").toLowerCase().includes(needle)))
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt)).slice(0, 200);
  $("admin-posts").replaceChildren(...(content.length ? content.map(entry => {
    const row = create("article", undefined, "admin-row"), info = create("div");
    info.append(create("strong", `@${entry.username || "Unknown user"} · ${entry.type === "community" ? entry.category || "Community" : "Timeline"}`), create("small", String(entry.content || "Photo post").slice(0, 240)), create("small", formatDate(entry.createdAt)));
    const actions = create("div", undefined, "admin-actions"), open = create("a", "View", "admin-action nav-button");
    open.href = entry.type === "community" ? "community.html" : `timeline.html#post-${entry.id}`;
    const remove = create("button", "Delete", "admin-action danger"); remove.type = "button";
    remove.onclick = async () => { if (!window.confirm("Delete this public content? This cannot be undone.")) return; remove.disabled = true; try { await deleteDoc(doc(db, entry.type === "community" ? "communityPosts" : "posts", entry.id)); setStatus("Content deleted."); } catch { setStatus("Could not delete that content.", true); remove.disabled = false; } };
    actions.append(open, remove); row.append(info, actions); return row;
  }) : [empty("No public content matches this search.")]));
}

function renderAnalytics() {
  const days = Array.from({ length: 14 }, (_, index) => new Date(Date.now() - (13 - index) * 86400000).toISOString().slice(0, 10));
  const values = days.map(day => ({ day, views: state.views.find(entry => entry.id === day)?.views || 0, users: state.users.filter(user => new Date(timestampMillis(user.createdAt) || 0).toISOString().slice(0, 10) === day).length }));
  const max = Math.max(1, ...values.flatMap(value => [value.views, value.users]));
  $("growth-chart").replaceChildren(...values.map(value => { const column = create("div", undefined, "chart-day"), bars = create("div", undefined, "chart-bars"), views = create("i", undefined, "views"), users = create("i", undefined, "users"); views.style.height = `${Math.max(3, value.views / max * 100)}%`; users.style.height = `${Math.max(3, value.users / max * 100)}%`; bars.append(views, users); column.append(bars, create("small", value.day.slice(5))); return column; }));
  const categories = [["Timeline posts", state.posts.length], ["Community posts", state.communityPosts.length], ["Comments", state.comments.length], ["Reactions", state.reactions.length]];
  const total = categories.reduce((sum, [, count]) => sum + count, 0) || 1;
  $("category-breakdown").replaceChildren(...categories.map(([label, count]) => { const row = create("div", undefined, "breakdown-row"), head = create("div"), track = create("div", undefined, "breakdown-track"), bar = create("i"); head.append(create("span", label), create("strong", String(count))); bar.style.width = `${Math.round(count / total * 100)}%`; track.append(bar); row.append(head, track); return row; }));
  const missingActivity = state.users.filter(user => timestampMillis(user.lastActiveAt) === null).length;
  const failedJobs = [...state.jobs.values()].filter(job => job.status === "failed").length;
  $("data-health").replaceChildren(healthRow("Accounts without recorded activity", missingActivity, missingActivity ? "warn" : "good"), healthRow("Deletion jobs needing attention", failedJobs, failedJobs ? "bad" : "good"), healthRow("Public posts shown", state.posts.length + state.communityPosts.length, "good"));
  const views = [...state.views].sort((a, b) => b.id.localeCompare(a.id));
  $("admin-views").replaceChildren(...(views.length ? views.map(view => { const row = create("article", undefined, "admin-row"); row.append(create("strong", view.id), create("span", `${view.views || 0} views`)); return row; }) : [empty("No daily view records yet.")]));
  renderProcessorHealth();
}

const healthRow = (label, value, tone) => { const row = create("div", undefined, `health-row ${tone}`); row.append(create("span", label), create("strong", String(value))); return row; };
function renderProcessorHealth() { const health = processorHealth(state.processor); $("processor-health").textContent = health.kind === "working" ? "Working normally. Permanent deletion is being checked automatically." : health.kind === "delayed" ? "Delayed. The service has not checked in recently; it will keep retrying." : "Not running. Open the recovery page to restore the account deletion service."; $("processor-health").className = `status-${health.kind}`; }
function renderAll() { renderMetrics(); renderUsers(); renderContent(); renderAnalytics(); }

function updateDialogConfirmation() { $("delete-account-confirm").disabled = !canConfirmDeletion({ typedUsername: $("delete-account-confirmation").value, targetUsername: dialogTarget?.username, blocked: !dialogState.open || state.jobs.has(dialogTarget?.id) }); }
function openDeletionDialog(user, trigger) { if (state.jobs.has(user.id)) { setStatus("That account is already locked for permanent deletion.", true); return; } dialogTarget = user; dialogTrigger = trigger; dialogState = { open: true, targetUid: user.id }; $("delete-account-target").textContent = `Account: @${user.username || "Unknown user"}`; $("delete-account-confirmation").value = ""; $("delete-account-dialog-status").textContent = ""; $("delete-account-dialog").showModal(); $("delete-account-confirmation").focus(); updateDialogConfirmation(); }
function closeDeletionDialog(message) { dialogState = { ...dialogState, open: false }; if ($("delete-account-dialog").open) $("delete-account-dialog").close(); if (message) setStatus(message, true); }
async function queueDeletion() { if (!dialogTarget || !canConfirmDeletion({ typedUsername: $("delete-account-confirmation").value, targetUsername: dialogTarget.username, blocked: state.jobs.has(dialogTarget.id) })) return; const button = $("delete-account-confirm"); button.disabled = true; try { const timestamp = serverTimestamp(), payloads = adminDeletionQueuePayloads({ targetUid: dialogTarget.id, requesterUid: adminUid, timestamp }), batch = writeBatch(db); batch.update(doc(db, "users", dialogTarget.id), payloads.profile); batch.set(doc(db, "adminDeletionJobs", dialogTarget.id), payloads.job); await batch.commit(); closeDeletionDialog(); setStatus("Account locked. Permanent deletion queued."); } catch { $("delete-account-dialog-status").textContent = "Could not queue permanent deletion. No changes were made."; updateDialogConfirmation(); } }

function observe(ref, key, transform = records) { unsubs.push(onSnapshot(ref, snapshot => { state[key] = transform(snapshot); renderAll(); }, () => setStatus("Could not load live dashboard data.", true))); }
function startLiveData() { if (!pageActive || !adminUid || listenersStarted) return; listenersStarted = true; observe(collection(db, "users"), "users"); observe(query(collection(db, "posts"), orderBy("createdAt", "desc")), "posts"); observe(query(collection(db, "communityPosts"), orderBy("createdAt", "desc")), "communityPosts"); observe(collection(db, "pageViews"), "views"); observe(collectionGroup(db, "comments"), "comments"); observe(collectionGroup(db, "reactions"), "reactions"); observe(collection(db, "adminDeletionJobs"), "jobs", snapshot => { const jobs = new Map(snapshot.docs.map(entry => [entry.id, entry.data()])); if (dialogState.open && dialogTarget) { const next = deletionDialogJobTransition(dialogState, jobs.has(dialogTarget.id) ? { id: dialogTarget.id, ...jobs.get(dialogTarget.id) } : null); if (!next.open) closeDeletionDialog(next.feedback); dialogState = next; } return jobs; }); observe(doc(db, "system", "deletionProcessor"), "processor", snapshot => snapshot.exists() ? snapshot.data() : null); heartbeatTimer = window.setInterval(renderProcessorHealth, 60 * 1000); }
function stopLiveData() { while (unsubs.length) unsubs.pop()(); if (heartbeatTimer) window.clearInterval(heartbeatTimer); heartbeatTimer = null; listenersStarted = false; }

$("admin-user-search").oninput = renderUsers; $("admin-content-search").oninput = renderContent; $("admin-content-type").onchange = renderContent;
document.querySelectorAll("[data-user-filter]").forEach(button => { button.onclick = () => { userFilter = button.dataset.userFilter; document.querySelectorAll("[data-user-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button))); renderUsers(); }; });
$("refresh-admin").onclick = () => { renderAll(); setStatus("Dashboard recalculated from live data."); }; $("admin-sign-out").onclick = async () => { await signOut(auth); location.replace("index.html"); };
$("delete-account-confirmation").oninput = updateDialogConfirmation; $("delete-account-confirm").onclick = queueDeletion; $("delete-account-dialog").addEventListener("close", () => { if (dialogTrigger?.isConnected) dialogTrigger.focus(); dialogTrigger = null; });
window.addEventListener("pagehide", () => { pageActive = false; stopLiveData(); }); window.addEventListener("pageshow", () => { pageActive = true; startLiveData(); });

onAuthStateChanged(auth, async user => { if (!user) { location.replace("index.html"); return; } const profile = await getDoc(doc(db, "users", user.uid)); const profileData = profile.exists() ? profile.data() : null, username = profileData?.username || ""; const reservation = isProtectedAdministrator(username) ? await getDoc(doc(db, "usernames", normalizeUsername(username))) : null; const authorized = !profileData?.banned && reservation?.exists() && reservation.data().uid === user.uid && reservation.data().username === username; if (!authorized) { location.replace("timeline.html"); return; } adminUid = user.uid; $("admin-identity").textContent = `Signed in as @${username}`; void recordPageActivity({ surface: "admin", profile: profileData, user, db, firestore: { doc, updateDoc, serverTimestamp }, isAuthorizedAdmin: authorized }); startLiveData(); });
