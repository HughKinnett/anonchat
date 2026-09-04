import { readFile, writeFile } from "node:fs/promises";

async function patch(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) return false;
  await writeFile(path, after);
  return true;
}

await patch("admin.html", html => html
  .replace('label class="sr-only" for="admin-user-search">Search by username</label><input id="admin-user-search" type="search" placeholder="Search by username"', 'label class="sr-only" for="admin-user-search">Search by username or user ID</label><input id="admin-user-search" type="search" placeholder="Search by username or user ID"'));

const adminInsert = [
'function moderationForUser(uid) { return state.accountModeration.get(uid) || {}; }',
'function userIsSuspended(uid) { const ms = timestampMillis(moderationForUser(uid).suspendedUntil); return ms !== null && ms > Date.now(); }',
'function userPostCount(uid) { return state.posts.filter(item => item.authorId === uid).length + state.communityPosts.filter(item => item.authorId === uid).length; }',
'function userFollowerCount(uid) { return state.follows.filter(item => item.followingId === uid).length; }',
'function userFollowingCount(uid) { return state.follows.filter(item => item.followerId === uid).length; }',
'function userReportCount(uid) { return state.moderationCases.filter(item => item.reportedUserId === uid).reduce((sum, item) => sum + Number(item.reportCount || 0), 0); }',
'',
'async function warnUser(user) {',
'  if (!user || isProtectedAdministrator(user.username)) { setStatus("Protected administrator accounts cannot receive admin warnings.", true); return; }',
'  const reason = window.prompt("Warning reason (plain language for the moderation history):", "Community guidelines warning"); if (reason === null) return;',
'  const current = moderationForUser(user.id);',
'  try { await setDoc(doc(db,"accountModeration",user.id), { uid:user.id, warningCount:Number(current.warningCount||0)+1, lastWarning:String(reason||"Community guidelines warning").trim().slice(0,300), lastWarningAt:serverTimestamp(), updatedAt:serverTimestamp(), updatedBy:adminUid }, {merge:true}); setStatus("Warning recorded for @"+(user.username||"user")+"."); } catch { setStatus("Could not record that warning.",true); }',
'}',
'async function toggleUserSuspension(user) {',
'  if (!user || isProtectedAdministrator(user.username)) { setStatus("Protected administrator accounts cannot be suspended.", true); return; }',
'  const suspended = userIsSuspended(user.id);',
'  if (!suspended && !window.confirm("Suspend this account for 24 hours? They will be blocked from normal posting, commenting, messaging, and room actions until the suspension expires.")) return;',
'  const until = suspended ? new Date(0) : new Date(Date.now()+24*60*60*1000);',
'  try { await setDoc(doc(db,"accountModeration",user.id), { uid:user.id, suspendedUntil:until, suspensionReason:suspended?"":"24-hour administrator suspension", updatedAt:serverTimestamp(), updatedBy:adminUid }, {merge:true}); setStatus(suspended?"Suspension ended.":"Account suspended for 24 hours."); } catch { setStatus("Could not change that suspension.",true); }',
'}',
''
].join("\n");

await patch("admin.js", js => {
  if (js.includes("function moderationForUser(uid)")) return js;
  let out = js.replace('moderationHistory: [], legacyRooms:', 'moderationHistory: [], accountModeration: new Map(), legacyRooms:');
  const anchor = 'function activityByUser() {';
  if (!out.includes(anchor)) throw new Error("activity anchor missing");
  out = out.replace(anchor, adminInsert + anchor);

  const oldInfo = 'info.append(create("strong", `@${user.username || "Unknown user"}`), create("small", status.kind === "deletion-pending" ? jobMessage(user) : status.label, `user-status status-${status.kind}`), create("small", `Last active: ${formatDate(user.lastActiveAt)}`));';
  const newInfo = 'const moderation = moderationForUser(user.id), suspended = userIsSuspended(user.id);\n  info.append(create("strong", `@${user.username || "Unknown user"}`), create("small", suspended ? "Suspended until " + formatDate(moderation.suspendedUntil) : (status.kind === "deletion-pending" ? jobMessage(user) : status.label), `user-status status-${suspended ? "banned" : status.kind}`), create("small", `User ID: ${user.id}`), create("small", `Account created: ${formatDate(user.createdAt)}`), create("small", `Last active: ${formatDate(user.lastActiveAt)}`), create("small", `Posts: ${userPostCount(user.id)} · Followers: ${userFollowerCount(user.id)} · Following: ${userFollowingCount(user.id)}`), create("small", `Reports: ${userReportCount(user.id)} · Warnings: ${Number(moderation.warningCount || 0)}`));';
  if (!out.includes(oldInfo)) throw new Error("user info anchor missing");
  out = out.replace(oldInfo, newInfo);

  const oldActions = 'actions.append(profile, ban, remove); row.append(info, actions); return row;';
  const newActions = 'const warn = create("button", "Warn user", "admin-action"); warn.type="button"; warn.disabled=protectedAdmin||locked; warn.onclick=()=>warnUser(user);\n  const suspend = create("button", userIsSuspended(user.id) ? "End suspension" : "Suspend 24 hours", `admin-action ${userIsSuspended(user.id) ? "restore" : "danger"}`); suspend.type="button"; suspend.disabled=protectedAdmin||locked; suspend.onclick=()=>toggleUserSuspension(user);\n  actions.append(profile, warn, suspend, ban, remove); row.append(info, actions); return row;';
  if (!out.includes(oldActions)) throw new Error("user actions anchor missing");
  out = out.replace(oldActions, newActions);

  const oldRenderUsers = 'const options = { ...userOptions(), filter: userFilter, search: $("admin-user-search").value.trim() };\n  const users = filterUsers(state.users, options).sort((left, right) => String(left.username || "").localeCompare(String(right.username || "")));';
  const newRenderUsers = 'const needle = $("admin-user-search").value.trim().toLowerCase();\n  const options = { ...userOptions(), filter: userFilter, search: "" };\n  const users = filterUsers(state.users, options).filter(user => !needle || String(user.username || "").toLowerCase().includes(needle) || String(user.id || "").toLowerCase().includes(needle)).sort((left, right) => String(left.username || "").localeCompare(String(right.username || "")));';
  if (!out.includes(oldRenderUsers)) throw new Error("renderUsers anchor missing");
  out = out.replace(oldRenderUsers, newRenderUsers);

  const reportActionsAnchor = 'actions.append(restore, removeMaterial, ban, removeProfile); row.append(info, actions); return row;';
  const reportActionsNew = 'const warnUserButton=create("button","Warn user","admin-action"); warnUserButton.type="button"; warnUserButton.disabled=!accountAvailable||protectedUser; warnUserButton.onclick=()=>warnUser(user);\n  const suspendUserButton=create("button",user&&userIsSuspended(user.id)?"End suspension":"Suspend 24 hours","admin-action danger"); suspendUserButton.type="button"; suspendUserButton.disabled=!accountAvailable||protectedUser; suspendUserButton.onclick=()=>toggleUserSuspension(user);\n  actions.append(restore, removeMaterial, warnUserButton, suspendUserButton, ban, removeProfile); row.append(info, actions); return row;';
  if (!out.includes(reportActionsAnchor)) throw new Error("report actions anchor missing");
  out = out.replace(reportActionsAnchor, reportActionsNew);

  const liveAnchor = '  unsubs.push(onSnapshot(query(collection(db, "adminDeletionJobs"), limit(100)), handleJobSnapshot, () => setStatus("Could not load live deletion status.", true)));';
  const liveNew = '  observe(query(collection(db, "accountModeration"), limit(100)), "accountModeration", () => { renderUsers(); renderReports(); }, snapshot => new Map(snapshot.docs.map(entry => [entry.id, entry.data()])));\n' + liveAnchor;
  if (!out.includes(liveAnchor)) throw new Error("live account moderation anchor missing");
  out = out.replace(liveAnchor, liveNew);
  return out;
});

await patch("firestore.rules", rules => {
  if (rules.includes("function accountNotSuspended(uid)")) return rules;
  let out = rules;
  const afterAvailable = `    function hasNoDeletionBarrierAfter(uid) {`;
  const helper = `    function featureEnabled(featureName) {\n      return !exists(/databases/$(database)/documents/siteSettings/features)\n        || get(/databases/$(database)/documents/siteSettings/features).data.get(featureName, true) == true;\n    }\n\n    function accountNotSuspended(uid) {\n      return !exists(/databases/$(database)/documents/accountModeration/$(uid))\n        || !get(/databases/$(database)/documents/accountModeration/$(uid)).data.keys().hasAny(['suspendedUntil'])\n        || get(/databases/$(database)/documents/accountModeration/$(uid)).data.suspendedUntil <= request.time;\n    }\n\n`;
  if (!out.includes(afterAvailable)) throw new Error("rules helper anchor missing");
  out = out.replace(afterAvailable, helper + afterAvailable);
  out = out.replace("        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('banned', false) != true;", "        && getAfter(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('banned', false) != true\n        && accountNotSuspended(request.auth.uid);");
  out = out.replace("        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('banned', false) != true;", "        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.get('banned', false) != true\n        && accountNotSuspended(request.auth.uid);");

  out = out.replace("      allow create: if signedIn()\n        && request.auth.uid == userId", "      allow create: if signedIn()\n        && featureEnabled('registrationsEnabled')\n        && request.auth.uid == userId");
  out = out.replace("      allow create: if activeUserAfter() && (validOriginalPost() || validRepost(postId));", "      allow create: if activeUserAfter() && featureEnabled('postingEnabled') && (validOriginalPost() || validRepost(postId));");
  out = out.replace("      allow create: if activeUserAfter()\n        && request.resource.data.keys().hasOnly(['authorId', 'username', 'content', 'category', 'circleId', 'options', 'expiresAt', 'moderationState', 'createdAt'])", "      allow create: if activeUserAfter()\n        && featureEnabled('postingEnabled')\n        && request.resource.data.keys().hasOnly(['authorId', 'username', 'content', 'category', 'circleId', 'options', 'expiresAt', 'moderationState', 'createdAt'])");
  out = out.replace("      allow create: if activeUserAfter()\n        && contentAvailableAfter(documentPath)", "      allow create: if activeUserAfter()\n        && featureEnabled('commentsEnabled')\n        && contentAvailableAfter(documentPath)");
  out = out.replace("    match /rooms/{roomId} {\n      allow read: if signedIn() && visibleOrAdmin();\n      allow create: if activeUserAfter()", "    match /rooms/{roomId} {\n      allow read: if signedIn() && visibleOrAdmin();\n      allow create: if activeUserAfter() && featureEnabled('temporaryChatsEnabled')");
  out = out.replace("    match /roomMessages/{messageId} {", "    match /roomMessages/{messageId} {");
  out = out.replace("      allow create: if activeUserAfter()\n        && request.resource.data.keys().hasOnly(['roomId', 'senderId', 'tempName'", "      allow create: if activeUserAfter()\n        && featureEnabled('temporaryChatsEnabled')\n        && request.resource.data.keys().hasOnly(['roomId', 'senderId', 'tempName'");
  out = out.replace("    match /messageRequests/{requestId} {\n      allow read: if signedIn()", "    match /messageRequests/{requestId} {\n      allow read: if signedIn()");
  out = out.replace("      allow create: if activeUserAfter()\n        && accountAvailableAfter(request.resource.data.toId)", "      allow create: if activeUserAfter()\n        && featureEnabled('privateMessagingEnabled')\n        && accountAvailableAfter(request.resource.data.toId)");
  out = out.replace("      allow update: if activeUserAfter()\n        && accountAvailableAfter(request.resource.data.fromId)", "      allow update: if activeUserAfter()\n        && featureEnabled('privateMessagingEnabled')\n        && accountAvailableAfter(request.resource.data.fromId)");
  out = out.replace("    match /messageRequests/{requestId}/messages/{messageId} {\n      allow read: if activeUser()", "    match /messageRequests/{requestId}/messages/{messageId} {\n      allow read: if activeUser()");
  out = out.replace("      allow create: if activeUserAfter()\n        && request.resource.data.keys().hasOnly([\n          'participants'", "      allow create: if activeUserAfter()\n        && featureEnabled('privateMessagingEnabled')\n        && request.resource.data.keys().hasOnly([\n          'participants'");

  const settingsBlock = `    match /siteSettings/{settingId} {\n      allow read: if isAdmin();\n      allow write: if isAdmin();\n    }`;
  const settingsAndModeration = settingsBlock + `\n\n    match /accountModeration/{uid} {\n      allow read: if isAdmin() || (signedIn() && request.auth.uid == uid);\n      allow write: if isAdmin()\n        && exists(/databases/$(database)/documents/users/$(uid))\n        && !isProtectedAdministrator(get(/databases/$(database)/documents/users/$(uid)).data.username);\n    }`;
  if (!out.includes(settingsBlock)) throw new Error("site settings block missing");
  out = out.replace(settingsBlock, settingsAndModeration);
  return out;
});

console.log("expanded admin controls applied");
