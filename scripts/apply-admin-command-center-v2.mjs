import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) return false;
  await writeFile(path, after);
  return true;
}

const commandCenterHtml = `  <section class="command-center" aria-labelledby="attention-heading">
    <div class="admin-section-heading"><div><p class="admin-kicker">Start here</p><h2 id="attention-heading">Things needing attention</h2><p class="admin-note">The most important items are kept together so you know what needs action first.</p></div></div>
    <div class="attention-grid" aria-label="Items needing attention">
      <article class="attention-card"><span>Reports waiting</span><strong id="attention-open-reports">0</strong><small>Open reports that need an admin decision</small></article>
      <article class="attention-card"><span>Deletion problems</span><strong id="attention-failed-jobs">0</strong><small>Account deletions that need attention</small></article>
      <article class="attention-card"><span>Service health</span><strong id="attention-service-health">Checking…</strong><small>Moderation and deletion services</small></article>
    </div>
    <div class="command-center-grid">
      <section class="admin-panel command-panel" aria-labelledby="site-health-heading"><div class="admin-panel-heading"><div><h2 id="site-health-heading">Site health</h2><p class="admin-note">Plain-English status for the features people use most.</p></div></div><div id="site-health-list" class="health-list"></div></section>
      <section class="admin-panel command-panel" aria-labelledby="notification-health-heading"><div class="admin-panel-heading"><div><h2 id="notification-health-heading">Notification health</h2><p class="admin-note">Shows the latest notification-service status when AnonChat has one available.</p></div></div><p id="notification-health" class="status-message">Not checked here</p></section>
      <section class="admin-panel command-panel" aria-labelledby="feature-switches-heading"><div class="admin-panel-heading"><div><h2 id="feature-switches-heading">Feature switches</h2><p class="admin-note">Turn major parts of AnonChat on or pause them. Everything starts on unless you deliberately change it.</p></div></div><div id="feature-switches" class="feature-switches"></div></section>
      <section class="admin-panel command-panel" aria-labelledby="announcement-heading"><div class="admin-panel-heading"><div><h2 id="announcement-heading">Site announcement</h2><p class="admin-note">Create or remove the current AnonChat announcement.</p></div></div><label for="announcement-text">Announcement text</label><textarea id="announcement-text" maxlength="500" rows="5" placeholder="Example: Scheduled maintenance tonight at 11 PM."></textarea><label class="announcement-toggle"><input id="announcement-active" type="checkbox"> Announcement is active</label><div class="admin-actions"><button id="clear-announcement" class="admin-action" type="button">Clear announcement</button><button id="save-announcement" class="admin-action" type="button">Save announcement</button></div></section>
      <section class="admin-panel command-panel" aria-labelledby="emergency-heading"><div class="admin-panel-heading"><div><h2 id="emergency-heading">Emergency controls</h2><p class="admin-note">Quickly pause registrations, posting, or private messaging. Turning one off requires confirmation.</p></div></div><div id="emergency-controls" class="emergency-controls"></div></section>
      <section class="admin-panel command-panel" aria-labelledby="firebase-usage-heading"><div class="admin-panel-heading"><div><h2 id="firebase-usage-heading">Firebase usage</h2><p class="admin-note">A simple view for keeping AnonChat on the free Firebase plan.</p></div></div><p id="firebase-usage-note" class="usage-note">Loading usage summary…</p></section>
      <section class="admin-panel command-panel command-panel-wide" aria-labelledby="moderation-history-heading"><div class="admin-panel-heading"><div><h2 id="moderation-history-heading">Moderation history</h2><p class="admin-note">Recent admin moderation actions, who requested them, and whether they completed.</p></div></div><div id="moderation-history" class="admin-list compact-list"></div></section>
    </div>
  </section>

`;

await patch("admin.html", html => {
  if (html.includes('id="attention-open-reports"')) return html;
  const anchor = '  <section class="admin-panel" aria-labelledby="manage-users-heading">';
  if (!html.includes(anchor)) throw new Error("admin.html insertion anchor not found");
  return html.replace(anchor, commandCenterHtml + anchor).replace('<h2 id="reported-material-heading">Reported material</h2>', '<h2 id="reported-material-heading">Reports inbox</h2>');
});

const extraCss = `
/* Simplified task-first admin command center */
.command-center{margin-top:22px}.attention-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.attention-card{display:grid;gap:5px;padding:17px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}.attention-card>span{font-weight:850}.attention-card>strong{font-size:1.7rem}.attention-card>small{color:var(--muted);line-height:1.4}.command-center-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}.command-panel{margin-top:0}.command-panel-wide{grid-column:1/-1}.status-message,.usage-note{margin:14px 0 0;padding:12px;border-radius:12px;background:var(--surface-2);color:var(--muted);line-height:1.5}.status-chip{display:inline-flex;align-items:center;justify-content:center;min-width:92px;padding:5px 10px;border-radius:999px;font-size:.76rem;font-weight:850}.status-chip.good{background:rgba(74,222,128,.14);color:#86efac}.status-chip.bad{background:rgba(248,113,113,.14);color:#fca5a5}.feature-switches,.emergency-controls{display:grid;gap:10px;margin-top:14px}.feature-switch-row,.emergency-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border-radius:12px;background:var(--surface-2)}.feature-switch-row strong,.feature-switch-row small,.emergency-row strong,.emergency-row small{display:block}.feature-switch-row small,.emergency-row small{margin-top:4px;color:var(--muted);line-height:1.35}.feature-toggle{display:flex;align-items:center;gap:8px;font-weight:850}.feature-toggle input,.announcement-toggle input{width:20px;height:20px}.command-panel textarea{box-sizing:border-box;width:100%;margin-top:8px;padding:11px;border:1px solid var(--border);border-radius:12px;background:var(--surface-2);color:white;font:inherit;resize:vertical}.command-panel>label{display:block;margin-top:13px;font-weight:800}.announcement-toggle{display:flex!important;align-items:center;gap:8px}@media(max-width:760px){.attention-grid,.command-center-grid{grid-template-columns:1fr}.command-panel-wide{grid-column:auto}.feature-switch-row,.emergency-row{grid-template-columns:1fr}.feature-toggle{justify-content:space-between}}
`;
await patch("admin.css", css => css.includes("Simplified task-first admin command center") ? css : css + extraCss);

const jsLines = [
'const DEFAULT_FEATURES = Object.freeze({ registrationsEnabled: true, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true });',
'const FEATURE_INFO = [["registrationsEnabled","New registrations","Allow new people to create AnonChat accounts."],["postingEnabled","Posting","Allow users to create new timeline and community posts."],["commentsEnabled","Comments","Allow users to add new comments."],["privateMessagingEnabled","Private messaging","Allow private message requests and messages."],["temporaryChatsEnabled","Temporary chats","Allow temporary rooms and room messages."],["uploadsEnabled","Photo uploads","Allow users to attach new photos."],["spotifyEmbedsEnabled","Spotify embeds","Allow new Spotify playlist embeds."]];',
'const EMERGENCY_FEATURES = new Set(["registrationsEnabled", "postingEnabled", "privateMessagingEnabled"]);',
'const normalizeFeatures = value => Object.fromEntries(Object.entries(DEFAULT_FEATURES).map(([key, fallback]) => [key, typeof value?.[key] === "boolean" ? value[key] : fallback]));',
'const featureInfo = key => FEATURE_INFO.find(([candidate]) => candidate === key) || [key, key, ""];',
'const commandStatusChip = (label, tone) => create("span", label, "status-chip " + tone);',
'',
'async function saveFeatureSetting(key, enabled) {',
'  const [, label] = featureInfo(key);',
'  if (!enabled && EMERGENCY_FEATURES.has(key) && !window.confirm("This emergency control can stop registration, posting, or messaging for users. Continue?")) { renderCommandCenter(); return; }',
'  try {',
'    await setDoc(doc(db, "siteSettings", "features"), { ...state.features, [key]: enabled, updatedAt: serverTimestamp(), updatedBy: adminUid }, { merge: true });',
'    setStatus(label + (enabled ? " turned on." : " paused."));',
'  } catch { setStatus("Could not change " + label.toLowerCase() + ".", true); renderCommandCenter(); }',
'}',
'',
'function renderFeatureSwitches() {',
'  const host = $("feature-switches"); if (!host) return;',
'  host.replaceChildren(...FEATURE_INFO.map(([key,label,description]) => {',
'    const row=create("label",undefined,"feature-switch-row"), text=create("span"), toggle=create("span",undefined,"feature-toggle"), input=document.createElement("input");',
'    text.append(create("strong",label),create("small",description)); input.type="checkbox"; input.checked=state.features[key]!==false; input.setAttribute("aria-label",label+(input.checked?" on":" off")); input.onchange=()=>saveFeatureSetting(key,input.checked); toggle.append(commandStatusChip(input.checked?"On":"Paused",input.checked?"good":"bad"),input); row.append(text,toggle); return row;',
'  }));',
'}',
'',
'function renderEmergencyControls() {',
'  const host=$("emergency-controls"); if(!host) return;',
'  host.replaceChildren(...["registrationsEnabled","postingEnabled","privateMessagingEnabled"].map(key=>{ const [,label,description]=featureInfo(key), enabled=state.features[key]!==false, row=create("div",undefined,"emergency-row"), text=create("span"), button=create("button",enabled?"Pause "+label:"Turn "+label+" back on","admin-action "+(enabled?"danger":"restore")); text.append(create("strong",label),create("small",description)); button.type="button"; button.onclick=()=>saveFeatureSetting(key,!enabled); row.append(text,button); return row; }));',
'}',
'',
'function renderModerationHistory() {',
'  const host=$("moderation-history"); if(!host) return;',
'  const rows=[...state.moderationHistory].sort((a,b)=>(timestampMillis(b.updatedAt??b.requestedAt)??0)-(timestampMillis(a.updatedAt??a.requestedAt)??0)).slice(0,30).map(item=>{ const row=create("article",undefined,"admin-row"), info=create("div"), raw=String(item.action||"moderation action").replaceAll(/([A-Z])/g," $1").replaceAll("_"," ").trim(), action=raw.charAt(0).toUpperCase()+raw.slice(1); info.append(create("strong",action),create("small","Status: "+(item.status||"unknown")),create("small","Requested by: "+(item.requestedBy||"administrator")),create("small",formatDate(item.updatedAt??item.requestedAt))); row.append(info); return row; });',
'  host.replaceChildren(...(rows.length?rows:[empty("No recent moderation actions are available.")]));',
'}',
'',
'function renderCommandCenter() {',
'  if(!$("site-health-list")) return;',
'  const failedJobs=[...state.jobs.values()].filter(job=>job.data?.status==="failed").length, deletionHealth=processorHealth(state.processor), moderationHealth=state.moderationProcessorListenerHealthy?processorHealth(state.moderationProcessor):{kind:"not-running"}, servicesHealthy=deletionHealth.kind==="working"&&moderationHealth.kind==="working";',
'  $("attention-open-reports").textContent=String(state.openReportCount||0); $("attention-failed-jobs").textContent=String(failedJobs); $("attention-service-health").textContent=servicesHealthy?"Working":"Needs attention";',
'  const healthItems=[["Admin access",true,"Working"],["New registrations",state.features.registrationsEnabled,state.features.registrationsEnabled?"Available":"Paused"],["Posting",state.features.postingEnabled,state.features.postingEnabled?"Available":"Paused"],["Comments",state.features.commentsEnabled,state.features.commentsEnabled?"Available":"Paused"],["Private messaging",state.features.privateMessagingEnabled,state.features.privateMessagingEnabled?"Available":"Paused"],["Temporary chats",state.features.temporaryChatsEnabled,state.features.temporaryChatsEnabled?"Available":"Paused"],["Photo uploads",state.features.uploadsEnabled,state.features.uploadsEnabled?"Available":"Paused"],["Spotify embeds",state.features.spotifyEmbedsEnabled,state.features.spotifyEmbedsEnabled?"Available":"Paused"],["Moderation service",moderationHealth.kind==="working",moderationHealth.kind==="working"?"Working":"Needs attention"],["Account deletion service",deletionHealth.kind==="working",deletionHealth.kind==="working"?"Working":"Needs attention"]];',
'  $("site-health-list").replaceChildren(...healthItems.map(([label,good,value])=>healthRow(label,value,good?"good":"bad")));',
'  const notificationHealth=state.notificationProcessor?processorHealth(state.notificationProcessor):null; $("notification-health").textContent=!notificationHealth?"Not checked here — no notification-service heartbeat is available to this dashboard.":notificationHealth.kind==="working"?"Working normally. The notification service has checked in recently.":"Needs attention. The notification service is not reporting a healthy status.";',
'  $("firebase-usage-note").textContent="AnonChat is staying on the Firebase Spark plan / free plan. This browser dashboard cannot read exact Firebase billing quotas, so it will not guess. Current loaded snapshot: "+state.users.length+" users, "+(state.posts.length+state.communityPosts.length)+" public posts, "+state.comments.length+" comments, and "+state.reactions.length+" reactions.";',
'  renderFeatureSwitches(); renderEmergencyControls(); renderModerationHistory(); const text=$("announcement-text"), active=$("announcement-active"); if(document.activeElement!==text) text.value=state.announcement.text||""; active.checked=state.announcement.active===true;',
'}',
'',
'async function saveAnnouncement() { const text=$("announcement-text").value.trim().slice(0,500), active=$("announcement-active").checked; try { await setDoc(doc(db,"siteSettings","announcement"),{text,active:Boolean(active&&text),updatedAt:serverTimestamp(),updatedBy:adminUid},{merge:true}); setStatus(text?"Site announcement saved.":"Announcement cleared."); } catch { setStatus("Could not save the site announcement.",true); } }',
'async function clearAnnouncement() { $("announcement-text").value=""; $("announcement-active").checked=false; try { await setDoc(doc(db,"siteSettings","announcement"),{text:"",active:false,updatedAt:serverTimestamp(),updatedBy:adminUid},{merge:true}); setStatus("Site announcement cleared."); } catch { setStatus("Could not clear the site announcement.",true); } }',
''
];
const jsInsert = jsLines.join("\n");

await patch("admin.js", js => {
  if (js.includes("const DEFAULT_FEATURES")) return js;
  let out = js.replace('const state = { users: [], posts: [], communityPosts: [], views: [], comments: [], reactions: [], follows: [], circles: [], members: [], rooms: [], votes: [], jobs: new Map(), moderationCases: [], moderationActions: new Map(), legacyRooms: [], processor: null, moderationProcessor: null, moderationProcessorListenerHealthy: false };','const state = { users: [], posts: [], communityPosts: [], views: [], comments: [], reactions: [], follows: [], circles: [], members: [], rooms: [], votes: [], jobs: new Map(), moderationCases: [], moderationActions: new Map(), moderationHistory: [], legacyRooms: [], processor: null, moderationProcessor: null, moderationProcessorListenerHealthy: false, notificationProcessor: null, openReportCount: 0, features: { registrationsEnabled: true, postingEnabled: true, commentsEnabled: true, privateMessagingEnabled: true, temporaryChatsEnabled: true, uploadsEnabled: true, spotifyEmbedsEnabled: true }, announcement: { text: "", active: false } };');
  const activityAnchor='function activityByUser() {'; if(!out.includes(activityAnchor)) throw new Error("admin.js activity anchor not found"); out=out.replace(activityAnchor,jsInsert+activityAnchor);
  out=out.replace('  $("last-updated").textContent = `Live data updated ${new Date().toLocaleTimeString()}`;\n}','  $("last-updated").textContent = `Live data updated ${new Date().toLocaleTimeString()}`;\n  renderCommandCenter();\n}');
  out=out.replace('    syncReportActionListeners(); renderReports();','    syncReportActionListeners(); renderReports(); renderCommandCenter();');
  out=out.replace('function renderAll() { renderMetrics(); renderUsers(); renderReports(); renderContent(); renderAnalytics(); }','function renderAll() { renderMetrics(); renderUsers(); renderReports(); renderContent(); renderAnalytics(); renderCommandCenter(); }');
  const liveAnchor='  startReportQueue();\n  startLegacyRoomQueue();'; if(!out.includes(liveAnchor)) throw new Error("admin.js live anchor not found");
  const liveInsert=['  startReportQueue();','  startLegacyRoomQueue();','  unsubs.push(onSnapshot(query(collection(db, "moderationCases"), where("status", "in", ["open", "deleteQueued"]), limit(100)), snapshot => { state.openReportCount = snapshot.size; renderCommandCenter(); }, () => { state.openReportCount = 0; renderCommandCenter(); }));','  unsubs.push(onSnapshot(query(collection(db, "moderationActions"), limit(50)), snapshot => { state.moderationHistory = records(snapshot); renderModerationHistory(); }, () => { state.moderationHistory = []; renderModerationHistory(); }));','  unsubs.push(onSnapshot(doc(db, "siteSettings", "features"), snapshot => { state.features = normalizeFeatures(snapshot.exists() ? snapshot.data() : {}); renderCommandCenter(); }, () => { state.features = normalizeFeatures({}); setStatus("Could not load feature switches.", true); renderCommandCenter(); }));','  unsubs.push(onSnapshot(doc(db, "siteSettings", "announcement"), snapshot => { state.announcement = snapshot.exists() ? { text: String(snapshot.data().text || "").slice(0, 500), active: snapshot.data().active === true } : { text: "", active: false }; renderCommandCenter(); }, () => { state.announcement = { text: "", active: false }; setStatus("Could not load the site announcement.", true); renderCommandCenter(); }));','  unsubs.push(onSnapshot(doc(db, "system", "notificationProcessor"), snapshot => { state.notificationProcessor = snapshot.exists() ? snapshot.data() : null; renderCommandCenter(); }, () => { state.notificationProcessor = null; renderCommandCenter(); }));'].join('\n');
  out=out.replace(liveAnchor,liveInsert);
  out=out.replaceAll('renderProcessorHealth(); renderReports(); renderContent(); renderLegacyRooms();','renderProcessorHealth(); renderReports(); renderContent(); renderLegacyRooms(); renderCommandCenter();');
  const handlers='$("delete-account-confirmation").oninput = updateDialogConfirmation;'; if(!out.includes(handlers)) throw new Error("admin.js handlers anchor not found"); out=out.replace(handlers,'$("save-announcement").onclick = saveAnnouncement; $("clear-announcement").onclick = clearAnnouncement;\n'+handlers);
  return out;
});

await patch("firestore.rules", rules => {
  if (rules.includes("match /siteSettings/{settingId}")) return rules;
  const anchor='    match /admins/{adminId} {'; if(!rules.includes(anchor)) throw new Error("firestore.rules admin anchor not found");
  return rules.replace(anchor,'    match /siteSettings/{settingId} {\n      allow read: if isAdmin();\n      allow write: if isAdmin();\n    }\n\n'+anchor);
});

console.log("admin command center patches applied");
