import { auth, db } from "./firebase-config.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { adminDeletionQueuePayloads, canAdminSetBanned, canQueueAdminDeletion, isProtectedAdministrator, normalizeUsername } from "./admin-deletion-policy.mjs";
import { canConfirmDeletion, deletionDialogJobTransition, deletionJobRecord, filterModerationCases, filterUsers, generalContentDeletionPayloads, generalContentDeletionWriteMode, hasDeletionJob, isTerminalModerationAction, legacyRoomActionPayload, moderationActionPayload, moderationActionRetryPayload, moderationActionState, moderationActionsAvailable, moderationCaseRecord, moderationTranscriptMessage, processorHealth, queueFailureDialogTransition, resolveReportActionFocus, resolveUserFocus, sortInactiveUsers, statusForUser, timestampMillis } from "./admin-dashboard-policy.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection, collectionGroup, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, updateDoc, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
const state = { users: [], posts: [], communityPosts: [], views: [], comments: [], reactions: [], follows: [], circles: [], members: [], rooms: [], votes: [], jobs: new Map(), moderationCases: [], moderationActions: new Map(), moderationHistory: [], accountModeration: new Map(), legacyRooms: [], processor: null, moderationProcessor: null, moderationProcessorListenerHealthy: false, notificationProcessor: null, openReportCount: 0, features: { registrationsEnabled: false, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true, badgeAwardsEnabled: true, profilePinsEnabled: true, profileQrEnabled: true }, announcement: { text: "", active: false } };
const unsubs = [];
let adminUid = "", adminUser = null, userFilter = "all", reportFilter = "open", pageActive = true, listenersStarted = false, heartbeatTimer = null;
let dialogState = { open: false, targetUid: "", submitting: false }, dialogTarget = null, dialogTrigger = null;
const pendingModerationActions = new Map();
const pendingLegacyRoomActions = new Set(), loadedModerationEvidence = new Map(), loadedRoomTranscripts = new Map(), reportActionUnsubs = new Map();
const moderationEvidenceEpochs = new Map(), roomTranscriptEpochs = new Map();
let reportCasesUnsub = null, legacyRoomsUnsub = null, reportPageLast = null, legacyRoomPageLast = null;
const reportPageSize = 100, reportPageCursors = [];
const roomTranscriptPageSize = 100;
const legacyRoomPageSize = 100, legacyRoomPageCursors = [];

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

const DEFAULT_FEATURES = Object.freeze({ registrationsEnabled: false, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true, badgeAwardsEnabled: true, profilePinsEnabled: true, profileQrEnabled: true });
const FEATURE_INFO = [["registrationsEnabled","New registrations","Allow new people to create AnonChat accounts."],["postingEnabled","Posting","Allow users to create new timeline and community posts."],["commentsEnabled","Comments","Allow users to add new comments."],["privateMessagingEnabled","Private messaging","Allow private message requests and messages."],["temporaryChatsEnabled","Temporary chats","Allow temporary rooms and room messages."],["uploadsEnabled","Photo uploads","Allow users to attach new photos."],["spotifyEmbedsEnabled","Spotify embeds","Allow new Spotify playlist embeds."],["badgeAwardsEnabled","Badge awarding","Allow automatic achievement badges to be awarded."],["profilePinsEnabled","Profile pinning","Allow users to pin and unpin profile posts."],["profileQrEnabled","Profile QR","Allow users to open profile QR cards."]];
const EMERGENCY_FEATURES = new Set(["registrationsEnabled", "postingEnabled", "privateMessagingEnabled", "badgeAwardsEnabled", "profilePinsEnabled", "profileQrEnabled"]);
const normalizeFeatures = value => Object.fromEntries(Object.entries(DEFAULT_FEATURES).map(([key, fallback]) => [key, typeof value?.[key] === "boolean" ? value[key] : fallback]));
const featureInfo = key => FEATURE_INFO.find(([candidate]) => candidate === key) || [key, key, ""];
const commandStatusChip = (label, tone) => create("span", label, "status-chip " + tone);

async function saveFeatureSetting(key, enabled) {
  const [, label] = featureInfo(key);
  if (!enabled && EMERGENCY_FEATURES.has(key) && !window.confirm("This emergency control pauses a user-facing AnonChat feature. Continue?")) { renderCommandCenter(); return; }
  try {
    await setDoc(doc(db, "siteSettings", "features"), { ...state.features, [key]: enabled, updatedAt: serverTimestamp(), updatedBy: adminUid }, { merge: true });
    setStatus(label + (enabled ? " turned on." : " paused."));
  } catch { setStatus("Could not change " + label.toLowerCase() + ".", true); renderCommandCenter(); }
}

function renderFeatureSwitches() {
  const host = $("feature-switches"); if (!host) return;
  host.replaceChildren(...FEATURE_INFO.map(([key,label,description]) => {
    const row=create("label",undefined,"feature-switch-row"), text=create("span"), toggle=create("span",undefined,"feature-toggle"), input=document.createElement("input");
    text.append(create("strong",label),create("small",description)); input.type="checkbox"; input.checked=state.features[key]!==false; input.setAttribute("aria-label",label+(input.checked?" on":" off")); input.onchange=()=>saveFeatureSetting(key,input.checked); toggle.append(commandStatusChip(input.checked?"On":"Paused",input.checked?"good":"bad"),input); row.append(text,toggle); return row;
  }));
}

function renderEmergencyControls() {
  const host=$("emergency-controls"); if(!host) return;
  host.replaceChildren(...["registrationsEnabled","postingEnabled","privateMessagingEnabled","badgeAwardsEnabled","profilePinsEnabled","profileQrEnabled"].map(key=>{ const [,label,description]=featureInfo(key), enabled=state.features[key]!==false, row=create("div",undefined,"emergency-row"), text=create("span"), button=create("button",enabled?"Pause "+label:"Turn "+label+" back on","admin-action "+(enabled?"danger":"restore")); text.append(create("strong",label),create("small",description)); button.type="button"; button.onclick=()=>saveFeatureSetting(key,!enabled); row.append(text,button); return row; }));
}

function renderModerationHistory() {
  const host=$("moderation-history"); if(!host) return;
  const rows=[...state.moderationHistory].sort((a,b)=>(timestampMillis(b.updatedAt??b.requestedAt)??0)-(timestampMillis(a.updatedAt??a.requestedAt)??0)).slice(0,30).map(item=>{ const row=create("article",undefined,"admin-row"), info=create("div"), raw=String(item.action||"moderation action").replaceAll(/([A-Z])/g," $1").replaceAll("_"," ").trim(), action=raw.charAt(0).toUpperCase()+raw.slice(1); info.append(create("strong",action),create("small","Status: "+(item.status||"unknown")),create("small","Requested by: "+(item.requestedBy||"administrator")),create("small",formatDate(item.updatedAt??item.requestedAt))); row.append(info); return row; });
  host.replaceChildren(...(rows.length?rows:[empty("No recent moderation actions are available.")]));
}

function renderCommandCenter() {
  if(!$("site-health-list")) return;
  const failedJobs=[...state.jobs.values()].filter(job=>job.data?.status==="failed").length, deletionHealth=processorHealth(state.processor), moderationHealth=state.moderationProcessorListenerHealthy?processorHealth(state.moderationProcessor):{kind:"not-running"}, servicesHealthy=deletionHealth.kind==="working"&&moderationHealth.kind==="working";
  $("attention-open-reports").textContent=String(state.openReportCount||0); $("attention-failed-jobs").textContent=String(failedJobs); $("attention-service-health").textContent=servicesHealthy?"Working":"Needs attention";
  const healthItems=[["Admin access",true,"Working"],["New registrations",state.features.registrationsEnabled,state.features.registrationsEnabled?"Available":"Paused"],["Posting",state.features.postingEnabled,state.features.postingEnabled?"Available":"Paused"],["Comments",state.features.commentsEnabled,state.features.commentsEnabled?"Available":"Paused"],["Private messaging",state.features.privateMessagingEnabled,state.features.privateMessagingEnabled?"Available":"Paused"],["Temporary chats",state.features.temporaryChatsEnabled,state.features.temporaryChatsEnabled?"Available":"Paused"],["Photo uploads",state.features.uploadsEnabled,state.features.uploadsEnabled?"Available":"Paused"],["Spotify embeds",state.features.spotifyEmbedsEnabled,state.features.spotifyEmbedsEnabled?"Available":"Paused"],["Badge awarding",state.features.badgeAwardsEnabled,state.features.badgeAwardsEnabled?"Available":"Paused"],["Profile pinning",state.features.profilePinsEnabled,state.features.profilePinsEnabled?"Available":"Paused"],["Profile QR",state.features.profileQrEnabled,state.features.profileQrEnabled?"Available":"Paused"],["Moderation service",moderationHealth.kind==="working",moderationHealth.kind==="working"?"Working":"Needs attention"],["Account deletion service",deletionHealth.kind==="working",deletionHealth.kind==="working"?"Working":"Needs attention"]];
  $("site-health-list").replaceChildren(...healthItems.map(([label,good,value])=>healthRow(label,value,good?"good":"bad")));
  const notificationHealth=state.notificationProcessor?processorHealth(state.notificationProcessor):null; $("notification-health").textContent=!notificationHealth?"Not checked here — no notification-service heartbeat is available to this dashboard.":notificationHealth.kind==="working"?"Working normally. The notification service has checked in recently.":"Needs attention. The notification service is not reporting a healthy status.";
  $("firebase-usage-note").textContent="AnonChat is staying on the Firebase Spark plan / free plan. This browser dashboard cannot read exact Firebase billing quotas, so it will not guess. Current loaded snapshot: "+state.users.length+" users, "+(state.posts.length+state.communityPosts.length)+" public posts, "+state.comments.length+" comments, and "+state.reactions.length+" reactions.";
  renderFeatureSwitches(); renderEmergencyControls(); renderModerationHistory(); const text=$("announcement-text"), active=$("announcement-active"); if(document.activeElement!==text) text.value=state.announcement.text||""; active.checked=state.announcement.active===true;
}

async function saveAnnouncement() { const text=$("announcement-text").value.trim().slice(0,500), active=$("announcement-active").checked; try { await setDoc(doc(db,"siteSettings","announcement"),{text,active:Boolean(active&&text),updatedAt:serverTimestamp(),updatedBy:adminUid},{merge:true}); setStatus(text?"Site announcement saved.":"Announcement cleared."); } catch { setStatus("Could not save the site announcement.",true); } }
async function clearAnnouncement() { $("announcement-text").value=""; $("announcement-active").checked=false; try { await setDoc(doc(db,"siteSettings","announcement"),{text:"",active:false,updatedAt:serverTimestamp(),updatedBy:adminUid},{merge:true}); setStatus("Site announcement cleared."); } catch { setStatus("Could not clear the site announcement.",true); } }
function moderationForUser(uid) { return state.accountModeration.get(uid) || {}; }
function userIsSuspended(uid) { const ms = timestampMillis(moderationForUser(uid).suspendedUntil); return ms !== null && ms > Date.now(); }
function userPostCount(uid) { return state.posts.filter(item => item.authorId === uid).length + state.communityPosts.filter(item => item.authorId === uid).length; }
function userFollowerCount(uid) { return state.follows.filter(item => item.followingId === uid).length; }
function userFollowingCount(uid) { return state.follows.filter(item => item.followerId === uid).length; }
function userReportCount(uid) { return state.moderationCases.filter(item => item.reportedUserId === uid).reduce((sum, item) => sum + Number(item.reportCount || 0), 0); }

async function warnUser(user) {
  if (!user || isProtectedAdministrator(user.username)) { setStatus("Protected administrator accounts cannot receive admin warnings.", true); return; }
  const reason = window.prompt("Warning reason (plain language for the moderation history):", "Community guidelines warning"); if (reason === null) return;
  const current = moderationForUser(user.id);
  try { await setDoc(doc(db,"accountModeration",user.id), { uid:user.id, warningCount:Number(current.warningCount||0)+1, lastWarning:String(reason||"Community guidelines warning").trim().slice(0,300), lastWarningAt:serverTimestamp(), updatedAt:serverTimestamp(), updatedBy:adminUid }, {merge:true}); setStatus("Warning recorded for @"+(user.username||"user")+"."); } catch { setStatus("Could not record that warning.",true); }
}
async function toggleUserSuspension(user) {
  if (!user || isProtectedAdministrator(user.username)) { setStatus("Protected administrator accounts cannot be suspended.", true); return; }
  const suspended = userIsSuspended(user.id);
  if (!suspended && !window.confirm("Suspend this account for 24 hours? They will be blocked from normal posting, commenting, messaging, and room actions until the suspension expires.")) return;
  const until = suspended ? new Date(0) : new Date(Date.now()+24*60*60*1000);
  try { const batch=writeBatch(db); batch.set(doc(db,"accountModeration",user.id), { uid:user.id, suspendedUntil:until, suspensionReason:suspended?"":"24-hour administrator suspension", updatedAt:serverTimestamp(), updatedBy:adminUid }, {merge:true}); batch.update(doc(db,"users",user.id), { suspendedUntil:until }); await batch.commit(); setStatus(suspended?"Suspension ended.":"Account suspended for 24 hours."); } catch { setStatus("Could not change that suspension.",true); }
}
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
  renderCommandCenter();
}

function renderUserRow(user, scope) {
  const status = statusForUser(user, userOptions()), locked = state.jobs.has(user.id) || ["adminDeletionRequestedAt", "adminDeletionRequestedBy", "adminDeletionStatus"].some(key => key in user);
  const protectedAdmin = isProtectedAdministrator(user.username), row = create("article", undefined, "admin-row"), info = create("div");
  const moderation = moderationForUser(user.id), suspended = userIsSuspended(user.id);
  info.append(create("strong", `@${user.username || "Unknown user"}`), create("small", suspended ? "Suspended until " + formatDate(moderation.suspendedUntil) : (status.kind === "deletion-pending" ? jobMessage(user) : status.label), `user-status status-${suspended ? "banned" : status.kind}`), create("small", `User ID: ${user.id}`), create("small", `Account created: ${formatDate(user.createdAt)}`), create("small", `Last active: ${formatDate(user.lastActiveAt)}`), create("small", `Posts: ${userPostCount(user.id)} · Followers: ${userFollowerCount(user.id)} · Following: ${userFollowingCount(user.id)}`), create("small", `Reports: ${userReportCount(user.id)} · Warnings: ${Number(moderation.warningCount || 0)}`));
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
  const warn = create("button", "Warn user", "admin-action"); warn.type="button"; warn.disabled=protectedAdmin||locked; warn.onclick=()=>warnUser(user);
  const suspend = create("button", userIsSuspended(user.id) ? "End suspension" : "Suspend 24 hours", `admin-action ${userIsSuspended(user.id) ? "restore" : "danger"}`); suspend.type="button"; suspend.disabled=protectedAdmin||locked; suspend.onclick=()=>toggleUserSuspension(user);
  actions.append(profile, warn, suspend, ban, remove); row.append(info, actions); return row;
}

function restoreUserFocus(activeFocusKey) {
  if (!activeFocusKey) return;
  const availableFocusKeys = [...document.querySelectorAll("[data-focus-key]")].map(node => node.dataset.focusKey);
  const next = resolveUserFocus({ activeFocusKey, availableFocusKeys, fallbackFocusKey: "admin-user-search" });
  (next === "admin-user-search" ? $("admin-user-search") : controlByFocusKey(next))?.focus();
}

function renderUsers() {
  const activeFocusKey = currentUserFocusKey();
  const needle = $("admin-user-search").value.trim().toLowerCase();
  const options = { ...userOptions(), filter: userFilter, search: "" };
  const users = filterUsers(state.users, options).filter(user => !needle || String(user.username || "").toLowerCase().includes(needle) || String(user.id || "").toLowerCase().includes(needle)).sort((left, right) => String(left.username || "").localeCompare(String(right.username || "")));
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
  const warnUserButton=create("button","Warn user","admin-action"); warnUserButton.type="button"; warnUserButton.disabled=!accountAvailable||protectedUser; warnUserButton.onclick=()=>warnUser(user);
  const suspendUserButton=create("button",user&&userIsSuspended(user.id)?"End suspension":"Suspend 24 hours","admin-action danger"); suspendUserButton.type="button"; suspendUserButton.disabled=!accountAvailable||protectedUser; suspendUserButton.onclick=()=>toggleUserSuspension(user);
  actions.append(restore, removeMaterial, warnUserButton, suspendUserButton, ban, removeProfile); row.append(info, actions); return row;
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
    syncReportActionListeners(); renderReports(); renderCommandCenter();
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

async function loadContentEditHistory(entry, host, control) {
  const collectionName = entry.type === "community" ? "communityPosts" : "posts";
  control.disabled = true;
  host.replaceChildren(create("small", "Loading edit history…", "admin-note"));
  try {
    const postHistory = await getDocs(query(
      collection(db, collectionName, entry.id, "editHistory"),
      orderBy("archivedAt", "desc"),
      limit(20)
    ));
    const commentsSnapshot = await getDocs(query(
      collection(db, collectionName, entry.id, "comments"),
      limit(100)
    ));
    const editedComments = commentsSnapshot.docs.filter((comment) => Number(comment.data().editVersion || 0) > 0 || comment.data().editedAt);
    const commentHistories = await Promise.all(editedComments.map(async (comment) => ({
      comment,
      history: await getDocs(query(
        collection(db, collectionName, entry.id, "comments", comment.id, "editHistory"),
        orderBy("archivedAt", "desc"),
        limit(20)
      ))
    })));

    const sections = [];
    if (!postHistory.empty) {
      const section = create("section", undefined, "admin-edit-history");
      section.append(create("strong", "Previous post versions"));
      postHistory.docs.forEach((version) => {
        const data = version.data();
        const row = create("article", undefined, "admin-edit-version");
        row.append(
          create("small", "Version " + (data.editVersion ?? "?") + " · " + formatDate(data.archivedAt)),
          create("p", String(data.content || "Empty post text"))
        );
        section.append(row);
      });
      sections.push(section);
    }

    if (commentHistories.some(({ history }) => !history.empty)) {
      const section = create("section", undefined, "admin-edit-history");
      section.append(create("strong", "Previous comment versions"));
      commentHistories.forEach(({ comment, history }) => {
        if (history.empty) return;
        const current = comment.data();
        const heading = create("small", "Current comment by @" + (current.username || "anonymous") + ": " + String(current.text || "").slice(0, 120));
        section.append(heading);
        history.docs.forEach((version) => {
          const data = version.data();
          const row = create("article", undefined, "admin-edit-version");
          row.append(
            create("small", "Version " + (data.editVersion ?? "?") + " · " + formatDate(data.archivedAt)),
            create("p", String(data.content || "Empty comment text"))
          );
          section.append(row);
        });
      });
      sections.push(section);
    }

    host.replaceChildren(...(sections.length ? sections : [empty("No prior edited versions are available for this post or its loaded comments.")]));
    control.textContent = "Refresh edit history";
  } catch {
    host.replaceChildren(empty("Could not load edit history."));
    setStatus("Could not load that content's edit history.", true);
  } finally {
    control.disabled = false;
  }
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
    const historyHost = create("div", undefined, "admin-edit-history-host");
    const viewHistory = create("button", "View edit history", "admin-action");
    viewHistory.type = "button";
    viewHistory.onclick = () => loadContentEditHistory(entry, historyHost, viewHistory);
    info.append(historyHost);
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
    actions.append(open, viewHistory, remove); row.append(info, actions); return row;
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

function renderAll() { renderMetrics(); renderUsers(); renderReports(); renderContent(); renderAnalytics(); renderCommandCenter(); }
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
  observe(query(collection(db, "users"), limit(100)), "users", () => { renderMetrics(); renderUsers(); renderReports(); renderAnalytics(); });
  observe(query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100)), "posts", () => { renderMetrics(); renderContent(); renderAnalytics(); });
  observe(query(collection(db, "communityPosts"), orderBy("createdAt", "desc"), limit(100)), "communityPosts", () => { renderMetrics(); renderContent(); renderAnalytics(); });
  observe(query(collection(db, "pageViews"), limit(100)), "views", renderAnalytics); observe(query(collectionGroup(db, "comments"), limit(100)), "comments", renderAnalytics); observe(query(collectionGroup(db, "reactions"), limit(100)), "reactions", renderAnalytics);
  observe(query(collection(db, "follows"), limit(100)), "follows", renderAnalytics); observe(query(collection(db, "circles"), limit(100)), "circles", renderAnalytics); observe(query(collection(db, "circleMembers"), limit(100)), "members", renderAnalytics);
  observe(query(collection(db, "rooms"), limit(100)), "rooms", renderAnalytics); observe(query(collection(db, "communityVotes"), limit(100)), "votes", () => { renderMetrics(); renderAnalytics(); });
  startReportQueue();
  startLegacyRoomQueue();
  unsubs.push(onSnapshot(query(collection(db, "moderationCases"), where("status", "in", ["open", "deleteQueued"]), limit(100)), snapshot => { state.openReportCount = snapshot.size; renderCommandCenter(); }, () => { state.openReportCount = 0; renderCommandCenter(); }));
  unsubs.push(onSnapshot(query(collection(db, "moderationActions"), limit(50)), snapshot => { state.moderationHistory = records(snapshot); renderModerationHistory(); }, () => { state.moderationHistory = []; renderModerationHistory(); }));
  unsubs.push(onSnapshot(doc(db, "siteSettings", "features"), snapshot => { state.features = normalizeFeatures(snapshot.exists() ? snapshot.data() : {}); renderCommandCenter(); }, () => { state.features = normalizeFeatures({}); setStatus("Could not load feature switches.", true); renderCommandCenter(); }));
  unsubs.push(onSnapshot(doc(db, "siteSettings", "announcement"), snapshot => { state.announcement = snapshot.exists() ? { text: String(snapshot.data().text || "").slice(0, 500), active: snapshot.data().active === true } : { text: "", active: false }; renderCommandCenter(); }, () => { state.announcement = { text: "", active: false }; setStatus("Could not load the site announcement.", true); renderCommandCenter(); }));
  unsubs.push(onSnapshot(doc(db, "system", "notificationProcessor"), snapshot => { state.notificationProcessor = snapshot.exists() ? snapshot.data() : null; renderCommandCenter(); }, () => { state.notificationProcessor = null; renderCommandCenter(); }));
  observe(query(collection(db, "accountModeration"), limit(100)), "accountModeration", () => { renderUsers(); renderReports(); }, snapshot => new Map(snapshot.docs.map(entry => [entry.id, entry.data()])));
  unsubs.push(onSnapshot(query(collection(db, "adminDeletionJobs"), limit(100)), handleJobSnapshot, () => setStatus("Could not load live deletion status.", true)));
  unsubs.push(onSnapshot(doc(db, "system", "deletionProcessor"), snapshot => { state.processor = snapshot.exists() ? snapshot.data() : null; renderProcessorHealth(); }, () => { state.processor = null; renderProcessorHealth(); }));
  unsubs.push(onSnapshot(doc(db, "system", "moderationProcessor"), { includeMetadataChanges: true }, snapshot => {
    state.moderationProcessorListenerHealthy = snapshot.metadata.fromCache !== true;
    state.moderationProcessor = snapshot.exists() ? snapshot.data() : null;
    renderProcessorHealth(); renderReports(); renderContent(); renderLegacyRooms(); renderCommandCenter();
  }, () => {
    state.moderationProcessorListenerHealthy = false; state.moderationProcessor = null;
    renderProcessorHealth(); renderReports(); renderContent(); renderLegacyRooms(); renderCommandCenter();
  }));
  heartbeatTimer = window.setInterval(() => { renderProcessorHealth(); renderReports(); renderContent(); renderLegacyRooms(); renderCommandCenter(); }, 60 * 1000);
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
$("save-announcement").onclick = saveAnnouncement; $("clear-announcement").onclick = clearAnnouncement;
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
  void recordPageActivity({ surface: "admin", profile: profileData, user, db, firestore: { doc, updateDoc, serverTimestamp }, isAuthorizedAdmin: authorized }); startLiveData();
});
