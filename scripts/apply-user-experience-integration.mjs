import { readFile, writeFile, unlink } from "node:fs/promises";

const files = new Map();
const load = async (name) => files.has(name) ? files.get(name) : files.set(name, await readFile(name, "utf8")).get(name);
const save = async (name, text) => { files.set(name, text); await writeFile(name, text); };
const replaceOnce = async (name, oldText, newText) => {
  const source = await load(name);
  if (source.includes(newText)) return;
  const count = source.split(oldText).length - 1;
  if (count < 1) throw new Error(`${name}: integration anchor not found: ${oldText.slice(0, 80)}`);
  await save(name, source.replace(oldText, newText));
};
const ensureContains = async (name, needle) => { if (!(await load(name)).includes(needle)) throw new Error(`${name}: expected ${needle}`); };

// Shared stylesheet and navigation links.
for (const name of ["timeline.html", "profile.html", "community.html", "admin.html"]) {
  const anchor = name === "community.html" ? '<link rel="stylesheet" href="community.css">' : '<link rel="stylesheet" href="timeline.css">';
  await replaceOnce(name, anchor, `${anchor}\n  <link rel="stylesheet" href="user-experience.css">`);
}
await replaceOnce("timeline.html", '<a href="timeline.html">Timeline</a><a href="community.html">Community</a>', '<a href="timeline.html">Timeline</a><a href="discover.html" data-requires-ux-feature="discoveryEnabled">Discover</a><a href="saved.html">Saved</a><a href="community.html">Community</a>');
await replaceOnce("profile.html", '<nav id="main-menu-panel" class="main-menu-panel" hidden><a href="timeline.html">Timeline</a><a href="community.html">Community</a>', '<nav id="main-menu-panel" class="main-menu-panel" hidden><a href="timeline.html">Timeline</a><a href="discover.html" data-requires-ux-feature="discoveryEnabled">Discover</a><a href="saved.html">Saved</a><a href="community.html">Community</a>');
await replaceOnce("community.html", '          <a href="timeline.html">Timeline</a>\n          <a href="community.html" aria-current="page">Community</a>', '          <a href="timeline.html">Timeline</a>\n          <a href="discover.html" data-requires-ux-feature="discoveryEnabled">Discover</a>\n          <a href="saved.html">Saved</a>\n          <a href="community.html" aria-current="page">Community</a>');

// Profile extras: about, badges, pins and share.
const profileExtras = `    <section class="profile-about-grid">
      <article class="ux-card"><p class="eyebrow">About</p><h2>About this user</h2><p id="profile-status-line" class="profile-status-line" hidden></p><p id="profile-about">Loading bio…</p><div id="profile-interests" class="profile-interests"></div>
        <form id="profile-extras-form" class="profile-extras-form" hidden><label>Bio<textarea id="profile-bio-input" maxlength="240" rows="3" placeholder="Tell the community a little about your pseudonymous self"></textarea></label><label>Status<input id="profile-status-input" maxlength="80" placeholder="What are you up to?"></label><label>Interests<input id="profile-interests-input" maxlength="240" placeholder="music, gaming, outdoors"></label><button class="primary-button" type="submit">Save profile details</button></form>
      </article>
      <article class="ux-card" data-requires-ux-feature="badgesEnabled"><p class="eyebrow">Recognition</p><h2>Badges</h2><div id="profile-badges" class="profile-badge-grid"></div></article>
    </section>
    <section class="ux-card"><p class="eyebrow">Featured by this user</p><h2>Pinned posts</h2><div id="profile-pinned-posts" class="profile-pinned-posts"></div></section>
    <section id="profile-share-card" class="ux-card"></section>

`;
await replaceOnce("profile.html", '    <section id="profile-spotify-card"', `${profileExtras}    <section id="profile-spotify-card"`);

// Community: persistent groups, request privacy, notification and accessibility controls.
await replaceOnce("community.html", '      <button role="tab" aria-selected="false" data-panel="messages-panel">Messages</button>\n      <button role="tab" aria-selected="false" data-panel="privacy-panel">Privacy</button>', '      <button role="tab" aria-selected="false" data-panel="messages-panel">Messages</button>\n      <button role="tab" aria-selected="false" data-panel="group-chats-panel" data-requires-ux-feature="groupChatsEnabled">Private groups</button>\n      <button role="tab" aria-selected="false" data-panel="privacy-panel">Privacy</button>');
await replaceOnce("community.html", '          <label>User<select id="message-user"></select></label>', '          <label>User<select id="message-user"></select></label>\n          <label>Who can request to message me?<select id="message-request-privacy"><option value="everyone">Everyone</option><option value="following">People I follow</option><option value="mutual">Mutual follows</option><option value="nobody">Nobody</option></select></label>');
await replaceOnce("community.html", '          <div id="direct-messages" class="message-stream"></div>', '          <div id="direct-typing-indicator" class="typing-indicator" aria-live="polite"></div>\n          <div id="direct-reply-preview" class="reply-preview" hidden></div>\n          <div id="direct-messages" class="message-stream"></div>');
const groupsPanel = `
    <section id="group-chats-panel" class="panel" role="tabpanel" hidden data-requires-ux-feature="groupChatsEnabled">
      <div class="group-chat-layout">
        <div class="card"><h2>Private groups</h2><form id="group-create-form"><label>Group name<input id="group-name" maxlength="60" required></label><label>Invite usernames<input id="group-members" placeholder="@friend1, @friend2" required></label><button class="primary" type="submit">Create group</button></form><div id="group-chat-list" class="stack compact"></div></div>
        <div class="card"><h2 id="group-chat-title">Choose a group</h2><p class="muted">Persistent private groups are visible only to invited members. Administrators can see group metadata for safety, not message text.</p><div id="group-messages" class="message-stream"></div><form id="group-message-form"><div class="message-entry-row"><input id="group-message" maxlength="1000" placeholder="Message your group"><button class="primary">Send</button></div></form></div>
      </div>
    </section>
`;
await replaceOnce("community.html", '    <section id="privacy-panel" class="panel" role="tabpanel" hidden>', `${groupsPanel}\n    <section id="privacy-panel" class="panel" role="tabpanel" hidden>`);
const preferenceCards = `
      <section class="ux-card" data-requires-ux-feature="notificationControlsEnabled"><h2>Notification controls</h2><form id="notification-preferences"><div class="notification-preference-grid">
        <label><input type="checkbox" data-notification-category="comments"> Comments & replies</label><label><input type="checkbox" data-notification-category="reactions"> Reactions</label><label><input type="checkbox" data-notification-category="follows"> Follows</label><label><input type="checkbox" data-notification-category="directMessages"> Direct messages</label><label><input type="checkbox" data-notification-category="messageRequests"> Message requests</label><label><input type="checkbox" data-notification-category="roomMessages"> Room messages</label><label><input type="checkbox" data-notification-category="mentions"> Mentions</label><label><input type="checkbox" data-notification-category="reveals"> Reveal requests</label><label><input type="checkbox" data-notification-category="groupMessages"> Group messages</label></div><h3>Quiet hours</h3><label class="switch"><input id="quiet-hours-enabled" type="checkbox"> Suppress phone alerts during quiet hours</label><div class="ux-actions"><label>Start<input id="quiet-hours-start" type="time" value="22:00"></label><label>End<input id="quiet-hours-end" type="time" value="07:00"></label></div><button class="primary" type="submit">Save notification settings</button></form></section>
      <section class="ux-card"><h2>Appearance & accessibility</h2><label>Appearance<select id="appearance-select"><option value="system">Use device setting</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Text size<select id="text-size-select"><option value="0.9">Small</option><option value="1" selected>Standard</option><option value="1.15">Large</option><option value="1.3">Extra large</option></select></label></section>
`;
await replaceOnce("community.html", '    </section>\n  </main>\n  <script type="module" src="community.js"></script>', `    </section>\n${preferenceCards}  </main>\n  <script type="module" src="community.js"></script>`);

// Admin badge and UX command-center sections.
const adminUx = `
      <section id="badge-management" class="admin-panel command-panel command-panel-wide" aria-labelledby="badge-management-heading"><div class="admin-panel-heading"><div><h2 id="badge-management-heading">Badges</h2><p class="admin-note">Award, remove, and define original AnonChat recognition badges. Badge artwork is visible on profiles.</p></div></div><div id="admin-badge-catalog" class="admin-billing-grid"></div><div class="admin-billing-grid"><form id="award-badge-form" class="admin-billing-field"><h3>Award or remove a badge</h3><label for="award-user-id">User Firebase ID</label><input id="award-user-id" required placeholder="User ID"><label for="award-badge-id">Badge</label><select id="award-badge-id"></select><label for="award-badge-note">Private admin note</label><input id="award-badge-note" maxlength="140"><div class="admin-actions"><button class="admin-action" type="submit">Award badge</button><button id="revoke-badge" class="admin-action" type="button">Remove badge</button></div></form><form id="custom-badge-form" class="admin-billing-field"><h3>Custom badge definition</h3><label for="custom-badge-id">Badge ID</label><input id="custom-badge-id" placeholder="kind-contributor" required><label for="custom-badge-name">Name</label><input id="custom-badge-name" maxlength="50" required><label for="custom-badge-description">Description</label><input id="custom-badge-description" maxlength="180" required><label for="custom-badge-image">Local SVG artwork</label><input id="custom-badge-image" placeholder="badge-example.svg" required><button class="admin-action" type="submit">Save badge definition</button></form></div></section>
      <section class="admin-panel command-panel command-panel-wide" aria-labelledby="ux-controls-heading"><div class="admin-panel-heading"><div><h2 id="ux-controls-heading">User experience controls</h2><p class="admin-note">Pause a newer consumer feature without affecting the core timeline or private-chat system.</p></div><button id="refresh-user-experience-summary" class="admin-action" type="button">Refresh counts</button></div><form id="user-experience-controls" class="feature-switches"><label class="ux-switch-row"><input type="checkbox" data-ux-feature="badgesEnabled"> Badges</label><label class="ux-switch-row"><input type="checkbox" data-ux-feature="editingEnabled"> Post/comment editing & replies</label><label class="ux-switch-row"><input type="checkbox" data-ux-feature="galleriesEnabled"> Photo/GIF galleries</label><label class="ux-switch-row"><input type="checkbox" data-ux-feature="discoveryEnabled"> Discover / trending</label><label class="ux-switch-row"><input type="checkbox" data-ux-feature="groupChatsEnabled"> Private groups</label><label class="ux-switch-row"><input type="checkbox" data-ux-feature="notificationControlsEnabled"> Notification controls</label><button class="admin-action" type="submit">Save user-experience controls</button></form><div id="user-experience-summary" class="attention-grid"></div></section>
`;
await replaceOnce("admin.html", '      <section class="admin-panel command-panel command-panel-wide" aria-labelledby="moderation-history-heading">', `${adminUx}      <section class="admin-panel command-panel command-panel-wide" aria-labelledby="moderation-history-heading">`);

// Script loading.
await replaceOnce("timeline.html", '  <script type="module" src="timeline.js"></script>', '  <script type="module" src="timeline.js"></script>\n  <script type="module" src="content-extras.js"></script>\n  <script type="module" src="user-experience-gate.js"></script>\n  <script type="module" src="accessibility.js"></script>');
await replaceOnce("profile.html", '  <script type="module" src="profile.js"></script>', '  <script type="module" src="profile.js"></script>\n  <script type="module" src="profile-extras.js"></script>\n  <script type="module" src="content-extras.js"></script>\n  <script type="module" src="user-experience-gate.js"></script>\n  <script type="module" src="accessibility.js"></script>');
await replaceOnce("community.html", '  <script type="module" src="community.js"></script>', '  <script type="module" src="community.js"></script>\n  <script type="module" src="community-extras.js"></script>\n  <script type="module" src="user-experience-gate.js"></script>\n  <script type="module" src="accessibility.js"></script>');
await replaceOnce("admin.html", '</body>', '<script type="module" src="admin-experience.js"></script>\n<script type="module" src="accessibility.js"></script>\n</body>');
for (const name of ["discover.html", "saved.html"]) {
  await replaceOnce(name, '<script type="module" src="accessibility.js"></script>', '<script type="module" src="user-experience-gate.js"></script><script type="module" src="accessibility.js"></script>');
}

// Stable data attributes for extension modules.
await replaceOnce("timeline.js", '  item.dataset.interactionPath = parent.path;\n  item.id = `post-${sourceCollection}-${postDoc.id}`;', '  item.dataset.interactionPath = parent.path;\n  item.dataset.postId = postDoc.id;\n  item.dataset.postCollection = sourceCollection;\n  item.dataset.authorId = post.authorId;\n  item.id = `post-${sourceCollection}-${postDoc.id}`;');
await replaceOnce("timeline.js", '    commentItem.className = "comment-item";\n    const commenter = document.createElement("a");', '    commentItem.className = "comment-item";\n    commentItem.dataset.commentId = commentDoc.id;\n    commentItem.dataset.commentUid = comment.uid;\n    const commenter = document.createElement("a");');
await replaceOnce("profile.js", '    const item = document.createElement("li");\n    item.className = "feed-item";\n    if (targetPremiumSettings)', '    const item = document.createElement("li");\n    item.className = "feed-item";\n    item.dataset.postId = postDoc.id;\n    item.dataset.postCollection = postDoc.ref.parent.id;\n    item.dataset.authorId = post.authorId;\n    item.id = `post-${postDoc.ref.parent.id}-${postDoc.id}`;\n    if (targetPremiumSettings)');
await replaceOnce("profile.js", '      commentItem.className = "comment-item";\n      const author = document.createElement("a");', '      commentItem.className = "comment-item";\n      commentItem.dataset.commentId = commentDoc.id;\n      commentItem.dataset.commentUid = comment.uid;\n      const author = document.createElement("a");');

// Direct-message metadata hooks and visible room report button.
await replaceOnce("community.js", '    item.className = `message private-chat-bubble${data.senderId === state.user.uid ? " mine" : ""}`;\n    const sender = document.createElement("small");', '    item.className = `message private-chat-bubble${data.senderId === state.user.uid ? " mine" : ""}`;\n    item.dataset.messageId = message.id;\n    item.dataset.conversationId = message.ref.parent.parent.id;\n    item.dataset.senderId = data.senderId;\n    item.dataset.createdAt = String(data.createdAt?.toMillis?.() || 0);\n    const sender = document.createElement("small");');
await replaceOnce("community.js", '    attachRoomMessageHold(item, message);\n    return item;', '    attachRoomMessageHold(item, message);\n    if (data.senderId !== state.user.uid) {\n      const report = document.createElement("button");\n      report.type = "button"; report.className = `${REPORT_BUTTON_CLASS} room-visible-report`; report.textContent = "Report";\n      report.addEventListener("click", () => showRoomMessageActions(message));\n      item.append(report);\n    }\n    return item;');
await replaceOnce("community.js", '    await setDoc(messageRef, {\n      participants: [state.user.uid, other].sort(),', '    const replyToMessageId = $("direct-message").dataset.replyToMessageId || "";\n    const replyToSenderId = $("direct-message").dataset.replyToSenderId || "";\n    await setDoc(messageRef, {\n      participants: [state.user.uid, other].sort(),');
await replaceOnce("community.js", '    });\n    event.target.reset();\n    clearDirectPhoto();\n  } catch {\n    setStatus("Could not send private message.", true);', '    });\n    if (replyToMessageId) {\n      await setDoc(doc(db, "messageReplyLinks", `${acceptedRequest.id}__${messageRef.id}`), { conversationId: acceptedRequest.id, messageId: messageRef.id, senderId: state.user.uid, replyToMessageId, replyToSenderId, createdAt: serverTimestamp() });\n    }\n    $("direct-message").removeAttribute("data-reply-to-message-id"); $("direct-message").removeAttribute("data-reply-to-sender-id");\n    if ($("direct-reply-preview")) $("direct-reply-preview").hidden = true;\n    event.target.reset();\n    clearDirectPhoto();\n  } catch {\n    setStatus("Could not send private message.", true);');

// Hide the older destructive per-message button; new Delete-for-me + Unsend controls replace it.
let uxCss = await load("user-experience.css");
if (!uxCss.includes(".private-message-delete{display:none!important}")) uxCss += '\n.private-message-delete{display:none!important}html[data-ux-badges="off"] #profile-badges,html[data-ux-badges="off"] #badge-management{display:none!important}html[data-ux-editing="off"] .pin-post-button,html[data-ux-editing="off"] .comment-extra-actions{display:none!important}html[data-ux-galleries="off"] .post-media-grid{display:none!important}\n';
await save("user-experience.css", uxCss);

// Firestore helpers, privacy enforcement, and new collection rules.
await replaceOnce("firestore.rules", "settingId in ['features', 'announcement']", "settingId in ['features', 'announcement', 'userExperience']");
await replaceOnce("firestore.rules", '    match /siteSettings/{settingId} {', `    function uxFeatureEnabled(featureName) {\n      let path = /databases/$(database)/documents/siteSettings/userExperience;\n      return !exists(path) || get(path).data.get(featureName, true) == true;\n    }\n\n    function messageRequestAllowed(targetUid, senderUid) {\n      let privacyPath = /databases/$(database)/documents/messagePrivacy/$(targetUid);\n      let mode = exists(privacyPath) ? get(privacyPath).data.get('mode', 'everyone') : 'everyone';\n      return mode == 'everyone'\n        || (mode == 'following' && exists(/databases/$(database)/documents/follows/$(targetUid + '_' + senderUid)))\n        || (mode == 'mutual'\n          && exists(/databases/$(database)/documents/follows/$(targetUid + '_' + senderUid))\n          && exists(/databases/$(database)/documents/follows/$(senderUid + '_' + targetUid)));\n    }\n\n    match /siteSettings/{settingId} {`);
await replaceOnce("firestore.rules", "        && accountAvailableAfter(request.resource.data.toId)\n        && request.resource.data.keys().hasOnly", "        && accountAvailableAfter(request.resource.data.toId)\n        && messageRequestAllowed(request.resource.data.toId, request.auth.uid)\n        && request.resource.data.keys().hasOnly");

const newRules = `
    match /userExperienceProfiles/{uid} {
      allow read: if signedIn();
      allow create, update: if activeUserAfter() && uid == request.auth.uid
        && request.resource.data.keys().hasOnly(['uid','bio','status','interests','pinnedPostIds','updatedAt'])
        && request.resource.data.uid == uid
        && request.resource.data.get('bio','') is string && request.resource.data.get('bio','').size() <= 240
        && request.resource.data.get('status','') is string && request.resource.data.get('status','').size() <= 80
        && request.resource.data.get('interests',[]) is list && request.resource.data.get('interests',[]).size() <= 8
        && request.resource.data.get('pinnedPostIds',[]) is list && request.resource.data.get('pinnedPostIds',[]).size() <= 3
        && request.resource.data.updatedAt == request.time;
      allow delete: if signedIn() && uid == request.auth.uid;
    }

    match /badgeDefinitions/{badgeId} { allow read: if signedIn(); allow write: if isAdmin() && uxFeatureEnabled('badgesEnabled'); }
    match /userBadges/{uid}/awards/{badgeId} { allow read: if signedIn(); allow write: if isAdmin() && uxFeatureEnabled('badgesEnabled') && exists(/databases/$(database)/documents/users/$(uid)); }

    match /savedPosts/{uid}/items/{itemId} {
      allow read: if activeUser() && uid == request.auth.uid;
      allow create, update: if activeUserAfter() && uid == request.auth.uid
        && request.resource.data.ownerId == uid
        && request.resource.data.targetCollection in ['posts','communityPosts']
        && request.resource.data.targetId is string
        && request.resource.data.savedAt == request.time;
      allow delete: if signedIn() && uid == request.auth.uid;
    }

    match /contentEdits/{editId} {
      allow read: if signedIn();
      allow create, update: if activeUserAfter() && uxFeatureEnabled('editingEnabled')
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.content is string && request.resource.data.content.size() > 0 && request.resource.data.content.size() <= 2000
        && request.resource.data.editedAt == request.time
        && ((request.resource.data.kind == 'post'
            && request.resource.data.targetCollection in ['posts','communityPosts']
            && get(/databases/$(database)/documents/$(request.resource.data.targetCollection)/$(request.resource.data.targetId)).data.authorId == request.auth.uid)
          || (request.resource.data.kind == 'comment'
            && request.resource.data.targetCollection in ['posts','communityPosts']
            && get(/databases/$(database)/documents/$(request.resource.data.targetCollection)/$(request.resource.data.postId)/comments/$(request.resource.data.commentId)).data.uid == request.auth.uid));
      allow delete: if isAdmin() || (signedIn() && resource.data.ownerId == request.auth.uid);
    }

    match /postMedia/{mediaId} {
      allow read: if signedIn();
      allow create, update: if activeUserAfter() && uxFeatureEnabled('galleriesEnabled')
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.targetCollection in ['posts','communityPosts']
        && get(/databases/$(database)/documents/$(request.resource.data.targetCollection)/$(request.resource.data.targetId)).data.authorId == request.auth.uid
        && request.resource.data.images is list && request.resource.data.images.size() <= 4
        && request.resource.data.updatedAt == request.time;
      allow delete: if isAdmin() || (signedIn() && resource.data.ownerId == request.auth.uid);
    }

    match /commentReplies/{replyId} {
      allow read: if signedIn() && resource.data.get('moderationState','visible') != 'hidden';
      allow create: if activeUserAfter() && uxFeatureEnabled('editingEnabled')
        && request.resource.data.keys().hasOnly(['parentKey','targetCollection','postId','parentCommentId','uid','username','text','moderationState','createdAt'])
        && request.resource.data.targetCollection in ['posts','communityPosts']
        && request.resource.data.uid == request.auth.uid && request.resource.data.username == currentUsername()
        && request.resource.data.text is string && request.resource.data.text.size() > 0 && request.resource.data.text.size() <= 1000
        && request.resource.data.moderationState == 'visible' && request.resource.data.createdAt == request.time
        && exists(/databases/$(database)/documents/$(request.resource.data.targetCollection)/$(request.resource.data.postId)/comments/$(request.resource.data.parentCommentId));
      allow update: if isAdmin();
      allow delete: if isAdmin() || (signedIn() && resource.data.uid == request.auth.uid);
    }

    match /messagePrivacy/{uid} {
      allow read: if signedIn();
      allow create, update: if activeUserAfter() && uid == request.auth.uid
        && request.resource.data.keys().hasOnly(['uid','mode','updatedAt']) && request.resource.data.uid == uid
        && request.resource.data.mode in ['everyone','following','mutual','nobody'] && request.resource.data.updatedAt == request.time;
      allow delete: if signedIn() && uid == request.auth.uid;
    }

    match /notificationPreferences/{uid} {
      allow read: if signedIn() && uid == request.auth.uid;
      allow create, update: if activeUserAfter() && uid == request.auth.uid && uxFeatureEnabled('notificationControlsEnabled')
        && request.resource.data.uid == uid && request.resource.data.updatedAt == request.time;
      allow delete: if signedIn() && uid == request.auth.uid;
    }

    match /typingIndicators/{typingId} {
      allow read: if activeUser() && acceptedConversation(resource.data.conversationId);
      allow create, update: if activeUserAfter() && request.resource.data.uid == request.auth.uid
        && acceptedConversation(request.resource.data.conversationId)
        && request.resource.data.active is bool && request.resource.data.updatedAt == request.time;
      allow delete: if signedIn() && resource.data.uid == request.auth.uid;
    }

    match /messageVisibility/{uid}/items/{itemId} {
      allow read: if activeUser() && uid == request.auth.uid;
      allow create, update: if activeUserAfter() && uid == request.auth.uid
        && request.resource.data.ownerId == uid && acceptedConversation(request.resource.data.conversationId)
        && request.resource.data.hiddenAt == request.time;
      allow delete: if signedIn() && uid == request.auth.uid;
    }

    match /messageReactions/{reactionId} {
      allow read: if activeUser() && acceptedConversation(resource.data.conversationId);
      allow create, update: if activeUserAfter() && request.resource.data.uid == request.auth.uid
        && acceptedConversation(request.resource.data.conversationId)
        && request.resource.data.reaction in ['❤️','👍','😂','😮','😢','🔥']
        && request.resource.data.createdAt == request.time;
      allow delete: if signedIn() && resource.data.uid == request.auth.uid;
    }

    match /messageReplyLinks/{linkId} {
      allow read: if activeUser() && acceptedConversation(resource.data.conversationId);
      allow create: if activeUserAfter() && request.resource.data.senderId == request.auth.uid
        && acceptedConversation(request.resource.data.conversationId) && request.resource.data.createdAt == request.time;
      allow update: if false; allow delete: if signedIn() && resource.data.senderId == request.auth.uid;
    }

    match /messageUnsends/{unsendId} {
      allow read: if activeUser() && acceptedConversation(resource.data.conversationId);
      allow create: if activeUserAfter() && request.resource.data.senderId == request.auth.uid
        && acceptedConversation(request.resource.data.conversationId)
        && get(/databases/$(database)/documents/messageRequests/$(request.resource.data.conversationId)/messages/$(request.resource.data.messageId)).data.senderId == request.auth.uid
        && request.time <= get(/databases/$(database)/documents/messageRequests/$(request.resource.data.conversationId)/messages/$(request.resource.data.messageId)).data.createdAt + duration.value(15,'m')
        && request.resource.data.unsentAt == request.time;
      allow update: if false; allow delete: if false;
    }

    match /groupChats/{groupId} {
      allow read: if activeUser() && request.auth.uid in resource.data.memberIds;
      allow create: if activeUserAfter() && uxFeatureEnabled('groupChatsEnabled')
        && request.resource.data.keys().hasOnly(['ownerId','name','memberIds','createdAt','updatedAt'])
        && request.resource.data.ownerId == request.auth.uid && request.auth.uid in request.resource.data.memberIds
        && request.resource.data.name is string && request.resource.data.name.size() >= 1 && request.resource.data.name.size() <= 60
        && request.resource.data.memberIds is list && request.resource.data.memberIds.size() >= 2 && request.resource.data.memberIds.size() <= 20
        && request.resource.data.createdAt == request.time && request.resource.data.updatedAt == request.time;
      allow update: if activeUserAfter() && resource.data.ownerId == request.auth.uid && uxFeatureEnabled('groupChatsEnabled')
        && request.resource.data.ownerId == resource.data.ownerId && request.auth.uid in request.resource.data.memberIds
        && request.resource.data.memberIds is list && request.resource.data.memberIds.size() <= 20
        && request.resource.data.updatedAt == request.time;
      allow delete: if signedIn() && resource.data.ownerId == request.auth.uid;
      match /messages/{messageId} {
        allow read: if activeUser() && request.auth.uid in get(/databases/$(database)/documents/groupChats/$(groupId)).data.memberIds;
        allow create: if activeUserAfter() && uxFeatureEnabled('groupChatsEnabled')
          && request.auth.uid in get(/databases/$(database)/documents/groupChats/$(groupId)).data.memberIds
          && request.resource.data.keys().hasOnly(['senderId','username','text','createdAt'])
          && request.resource.data.senderId == request.auth.uid && request.resource.data.username == currentUsername()
          && request.resource.data.text is string && request.resource.data.text.size() > 0 && request.resource.data.text.size() <= 1000
          && request.resource.data.createdAt == request.time;
        allow update: if false;
        allow delete: if signedIn() && (resource.data.senderId == request.auth.uid || get(/databases/$(database)/documents/groupChats/$(groupId)).data.ownerId == request.auth.uid);
      }
    }
`;
let rules = await load("firestore.rules");
if (!rules.includes("match /userExperienceProfiles/{uid}")) {
  const tail = "    match /posts/{postId} {";
  const index = rules.lastIndexOf(tail);
  if (index < 0) throw new Error("firestore.rules: tail anchor not found");
  rules = `${rules.slice(0,index)}${newRules}\n${rules.slice(index)}`;
  await save("firestore.rules", rules);
}

// Service worker app shell and cache bump.
let sw = await load("sw.js");
sw = sw.replace(/const CACHE_NAME = "anonchat-v(\d+)";/, (_, version) => `const CACHE_NAME = "anonchat-v${Number(version)+1}";`);
const assets = ["./discover.html","./discover.js","./saved.html","./saved.js","./user-experience.css","./user-experience-policy.mjs","./badge-policy.mjs","./discovery-policy.mjs","./messaging-extras-policy.mjs","./accessibility-policy.mjs","./accessibility.js","./user-experience-gate.js","./profile-extras.js","./content-extras.js","./community-extras.js","./admin-experience.js",...['founding-member','community-helper','top-contributor','popular-post','long-time-member','premium-member','moderator','administrator'].map(id=>`./badge-${id}.svg`)];
for (const asset of assets) if (!sw.includes(`"${asset}"`)) sw = sw.replace('  "./anonchat-anonymous.png"', `  "${asset}",\n  "./anonchat-anonymous.png"`);
await save("sw.js", sw);

// Android distinct release package for this feature expansion.
await replaceOnce("android/app/build.gradle", "versionCode 4\n        versionName \"1.0.3\"", "versionCode 5\n        versionName \"1.0.4\"");

// Permanent test entry in the main CI chain.
const pkg = JSON.parse(await load("package.json"));
pkg.scripts["test:ux"] = "node scripts/test-user-experience-expansion.mjs";
if (!pkg.scripts["test:firestore-ci"].includes("npm run test:ux")) pkg.scripts["test:firestore-ci"] += " && npm run test:ux";
await save("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

// Self-clean one-shot integration helper/workflow so they do not land in production.
await unlink("scripts/apply-user-experience-integration.mjs").catch(()=>{});
await unlink(".github/workflows/apply-user-experience-integration.yml").catch(()=>{});

for (const [file, needle] of [
  ["profile.html", "profile-badges"], ["timeline.html", "discover.html"], ["community.html", "group-chats-panel"], ["admin.html", "badge-management"],
  ["firestore.rules", "match /userExperienceProfiles/{uid}"], ["sw.js", "./discover.html"], ["android/app/build.gradle", "versionCode 5"]
]) await ensureContains(file, needle);
console.log("user experience integration patches applied");
