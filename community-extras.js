import { auth, db } from "./firebase-config.js";
import { canReceiveMessageRequest, normalizeMessageRequestPrivacy, normalizeNotificationPreferences, normalizedQuietHours } from "./user-experience-policy.mjs";
import { MESSAGE_REACTIONS, canUnsendMessage, normalizeGroupMemberIds, normalizeGroupName } from "./messaging-extras-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let viewer = null;
let profile = null;
let currentConversationId = "";
let typingTimer = 0;
let stopTypingWatch = () => {};
let stopGroupWatch = () => {};
let activeGroupId = "";
let groupDocs = [];
let groupMessageDocs = [];
const decoratedDirectMessages = new WeakSet();
const hiddenMessageKeys = new Set();
const unsentMessageKeys = new Set();
const replyByMessage = new Map();
const reactionByMessage = new Map();

const messageKey = (conversationId, messageId) => `${conversationId}__${messageId}`;
const toast = (text) => { const node = document.createElement("div"); node.className = "ux-toast"; node.textContent = text; document.body.append(node); setTimeout(() => node.remove(), 1600); };

const loadPreferences = async () => {
  if (!viewer) return;
  const [privacySnap, notificationSnap] = await Promise.all([
    getDoc(doc(db, "messagePrivacy", viewer.uid)),
    getDoc(doc(db, "notificationPreferences", viewer.uid))
  ]);
  const privacy = normalizeMessageRequestPrivacy(privacySnap.exists() ? privacySnap.data().mode : "everyone");
  if ($("message-request-privacy")) $("message-request-privacy").value = privacy;
  const raw = notificationSnap.exists() ? notificationSnap.data() : {};
  const prefs = normalizeNotificationPreferences(raw.categories || raw);
  document.querySelectorAll("[data-notification-category]").forEach((input) => { input.checked = prefs[input.dataset.notificationCategory] !== false; });
  const quiet = normalizedQuietHours(raw.quietHours || {});
  if ($("quiet-hours-enabled")) $("quiet-hours-enabled").checked = quiet.enabled;
  if ($("quiet-hours-start")) $("quiet-hours-start").value = quiet.start;
  if ($("quiet-hours-end")) $("quiet-hours-end").value = quiet.end;
};

const saveMessagePrivacy = async () => {
  const mode = normalizeMessageRequestPrivacy($("message-request-privacy")?.value);
  await setDoc(doc(db, "messagePrivacy", viewer.uid), { uid: viewer.uid, mode, updatedAt: serverTimestamp() }, { merge: true });
  toast("Message-request privacy saved.");
};

const saveNotifications = async () => {
  const categories = normalizeNotificationPreferences(Object.fromEntries([...document.querySelectorAll("[data-notification-category]")]
    .map((input) => [input.dataset.notificationCategory, input.checked])));
  const quietHours = normalizedQuietHours({ enabled: $("quiet-hours-enabled")?.checked, start: $("quiet-hours-start")?.value, end: $("quiet-hours-end")?.value });
  await setDoc(doc(db, "notificationPreferences", viewer.uid), { uid: viewer.uid, categories, quietHours, updatedAt: serverTimestamp() }, { merge: true });
  toast("Notification preferences saved.");
};

const activeConversation = () => $("conversation-user")?.value || "";
const conversationRequestId = (otherUid) => [viewer.uid, otherUid].sort().join("_");

const setTyping = async (active) => {
  const other = activeConversation(); if (!viewer || !other) return;
  const conversationId = conversationRequestId(other); currentConversationId = conversationId;
  await setDoc(doc(db, "typingIndicators", `${conversationId}__${viewer.uid}`), { conversationId, uid: viewer.uid, active, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
};

const watchTyping = () => {
  stopTypingWatch(); stopTypingWatch = () => {};
  const other = activeConversation(); const host = $("direct-typing-indicator"); if (!viewer || !other || !host) return;
  const conversationId = conversationRequestId(other); currentConversationId = conversationId;
  stopTypingWatch = onSnapshot(query(collection(db, "typingIndicators"), where("conversationId", "==", conversationId), limit(4)), (snapshot) => {
    const active = snapshot.docs.some((entry) => entry.data().uid !== viewer.uid && entry.data().active === true && entry.data().updatedAt?.toMillis?.() > Date.now() - 15000);
    host.textContent = active ? "Typing…" : "";
  }, () => { host.textContent = ""; });
};

const loadMessageMetadata = async (conversationId) => {
  hiddenMessageKeys.clear(); unsentMessageKeys.clear(); replyByMessage.clear(); reactionByMessage.clear();
  if (!viewer || !conversationId) return;
  const [hidden, unsent, replies, reactions] = await Promise.all([
    getDocs(query(collection(db, "messageVisibility", viewer.uid, "items"), where("conversationId", "==", conversationId), limit(100))),
    getDocs(query(collection(db, "messageUnsends"), where("conversationId", "==", conversationId), limit(100))),
    getDocs(query(collection(db, "messageReplyLinks"), where("conversationId", "==", conversationId), limit(100))),
    getDocs(query(collection(db, "messageReactions"), where("conversationId", "==", conversationId), limit(200)))
  ]).catch(() => [null, null, null, null]);
  hidden?.docs.forEach((entry) => hiddenMessageKeys.add(messageKey(conversationId, entry.data().messageId)));
  unsent?.docs.forEach((entry) => unsentMessageKeys.add(messageKey(conversationId, entry.data().messageId)));
  replies?.docs.forEach((entry) => replyByMessage.set(entry.data().messageId, entry.data()));
  reactions?.docs.forEach((entry) => {
    const list = reactionByMessage.get(entry.data().messageId) || []; list.push(entry.data()); reactionByMessage.set(entry.data().messageId, list);
  });
  decorateDirectMessages();
};

const hideForMe = async (conversationId, messageId) => {
  const key = messageKey(conversationId, messageId);
  await setDoc(doc(db, "messageVisibility", viewer.uid, "items", key), { ownerId: viewer.uid, conversationId, messageId, hiddenAt: serverTimestamp() });
  hiddenMessageKeys.add(key); document.querySelector(`[data-message-key="${CSS.escape(key)}"]`)?.remove(); toast("Message hidden for you.");
};

const unsend = async (item) => {
  const conversationId = item.dataset.conversationId; const messageId = item.dataset.messageId; const createdAt = Number(item.dataset.createdAt || 0);
  if (!canUnsendMessage({ senderId: item.dataset.senderId, createdAt }, viewer.uid, Date.now())) { toast("Unsend is available for 15 minutes after sending."); return; }
  const key = messageKey(conversationId, messageId);
  await setDoc(doc(db, "messageUnsends", key), { conversationId, messageId, senderId: viewer.uid, unsentAt: serverTimestamp() });
  unsentMessageKeys.add(key); item.querySelector("span:not(.private-message-actions)")?.replaceChildren(document.createTextNode("Message unsent")); toast("Message unsent.");
};

const react = async (item, reaction) => {
  const conversationId = item.dataset.conversationId; const messageId = item.dataset.messageId; const key = `${messageKey(conversationId, messageId)}__${viewer.uid}`;
  await setDoc(doc(db, "messageReactions", key), { conversationId, messageId, uid: viewer.uid, reaction, createdAt: serverTimestamp() });
  const list = reactionByMessage.get(messageId) || []; const index = list.findIndex((entry) => entry.uid === viewer.uid); const next = { conversationId, messageId, uid: viewer.uid, reaction };
  if (index >= 0) list[index] = next; else list.push(next); reactionByMessage.set(messageId, list); decorateReactionSummary(item);
};

const decorateReactionSummary = (item) => {
  let host = item.querySelector(".message-reaction-summary"); if (!host) { host = document.createElement("div"); host.className = "message-reaction-summary"; item.append(host); }
  const counts = new Map(); for (const entry of reactionByMessage.get(item.dataset.messageId) || []) counts.set(entry.reaction, (counts.get(entry.reaction) || 0) + 1);
  host.textContent = [...counts].map(([emoji, count]) => `${emoji} ${count}`).join("  "); host.hidden = counts.size === 0;
};

const beginReply = (item) => {
  const input = $("direct-message"); const preview = $("direct-reply-preview"); if (!input || !preview) return;
  input.dataset.replyToMessageId = item.dataset.messageId; input.dataset.replyToSenderId = item.dataset.senderId;
  preview.hidden = false; preview.textContent = `Replying to @${item.querySelector("small")?.textContent?.replace(/^@/, "") || "user"}`; input.focus();
};

const decorateDirectMessages = () => {
  document.querySelectorAll("#direct-messages .private-chat-bubble[data-message-id]").forEach((item) => {
    const conversationId = item.dataset.conversationId; const key = messageKey(conversationId, item.dataset.messageId); item.dataset.messageKey = key;
    if (hiddenMessageKeys.has(key)) { item.remove(); return; }
    if (unsentMessageKeys.has(key)) {
      const text = item.querySelector("span:not(.private-message-actions)"); if (text) text.textContent = "Message unsent";
      item.querySelector(".message-photo,.view-once-photo-button")?.remove();
    }
    const replyLink = replyByMessage.get(item.dataset.messageId); if (replyLink && !item.querySelector(".reply-preview")) { const preview = document.createElement("div"); preview.className = "reply-preview"; preview.textContent = "↩ Reply to an earlier message"; item.insertBefore(preview, item.children[1] || null); }
    decorateReactionSummary(item);
    if (decoratedDirectMessages.has(item)) return; decoratedDirectMessages.add(item);
    const actions = document.createElement("div"); actions.className = "message-extra-actions";
    const reply = document.createElement("button"); reply.type = "button"; reply.className = "ux-small-button"; reply.textContent = "↩ Reply"; reply.onclick = () => beginReply(item); actions.append(reply);
    const reactButton = document.createElement("button"); reactButton.type = "button"; reactButton.className = "ux-small-button"; reactButton.textContent = "☺ React"; reactButton.onclick = () => { const choice = prompt(`React with ${MESSAGE_REACTIONS.join(" ")}`, "❤️"); if (MESSAGE_REACTIONS.includes(choice)) void react(item, choice); }; actions.append(reactButton);
    const hide = document.createElement("button"); hide.type = "button"; hide.className = "ux-small-button"; hide.textContent = "Delete for me"; hide.onclick = () => void hideForMe(conversationId, item.dataset.messageId); actions.append(hide);
    if (item.dataset.senderId === viewer.uid) { const undo = document.createElement("button"); undo.type = "button"; undo.className = "ux-small-button"; undo.textContent = "Unsend"; undo.onclick = () => void unsend(item); actions.append(undo); }
    item.append(actions);
  });
};

const loadGroups = () => {
  stopGroupWatch();
  stopGroupWatch = onSnapshot(query(collection(db, "groupChats"), where("memberIds", "array-contains", viewer.uid), limit(30)), (snapshot) => { groupDocs = snapshot.docs; renderGroups(); if (activeGroupId) watchGroupMessages(activeGroupId); }, () => { $("group-chat-list").textContent = "Could not load group chats."; });
};
const renderGroups = () => {
  const host = $("group-chat-list"); if (!host) return;
  host.replaceChildren(...groupDocs.map((entry) => { const data = entry.data(); const button = document.createElement("button"); button.type = "button"; button.className = "discover-item"; button.textContent = `${data.name} · ${data.memberIds.length} members`; button.onclick = () => { activeGroupId = entry.id; $("group-chat-title").textContent = data.name; watchGroupMessages(entry.id); }; return button; }));
  if (!groupDocs.length) host.textContent = "No private groups yet.";
};
const watchGroupMessages = (groupId) => {
  const group = groupDocs.find((entry) => entry.id === groupId); if (!group) return;
  onSnapshot(query(collection(db, "groupChats", groupId, "messages"), limit(100)), (snapshot) => { groupMessageDocs = snapshot.docs.sort((a, b) => (a.data().createdAt?.seconds || 0) - (b.data().createdAt?.seconds || 0)); renderGroupMessages(); }, () => { $("group-messages").textContent = "Could not load messages."; });
};
const renderGroupMessages = () => {
  const host = $("group-messages"); if (!host) return;
  host.replaceChildren(...groupMessageDocs.map((entry) => { const data = entry.data(); const item = document.createElement("div"); item.className = `message${data.senderId === viewer.uid ? " mine" : ""}`; const who = document.createElement("small"); who.textContent = `@${data.username || "anonymous"}`; const text = document.createElement("span"); text.textContent = data.text; item.append(who, text); return item; })); host.scrollTop = host.scrollHeight;
};
const createGroup = async (event) => {
  event.preventDefault(); const name = normalizeGroupName($("group-name")?.value); const rawMembers = String($("group-members")?.value || "").split(",").map((value) => value.trim()).filter(Boolean);
  const users = await getDocs(query(collection(db, "users"), limit(100))); const usernameMap = new Map(users.docs.map((entry) => [entry.data().username?.toLowerCase(), entry.id]));
  const memberIds = normalizeGroupMemberIds(viewer.uid, rawMembers.map((nameValue) => usernameMap.get(nameValue.replace(/^@/, "").toLowerCase())).filter(Boolean));
  if (!name || memberIds.length < 2) { toast("Add a group name and at least one valid username."); return; }
  await addDoc(collection(db, "groupChats"), { ownerId: viewer.uid, name, memberIds, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }); event.target.reset(); toast("Private group created.");
};
const sendGroupMessage = async (event) => {
  event.preventDefault(); const group = groupDocs.find((entry) => entry.id === activeGroupId); const text = $("group-message")?.value.trim(); if (!group || !text) return;
  await addDoc(collection(db, "groupChats", group.id, "messages"), { senderId: viewer.uid, username: profile?.username || "anonymous", text: text.slice(0, 1000), createdAt: serverTimestamp() }); event.target.reset();
};

const observer = new MutationObserver(() => decorateDirectMessages()); observer.observe(document.documentElement, { childList: true, subtree: true });
$("message-request-privacy")?.addEventListener("change", () => void saveMessagePrivacy().catch(() => toast("Could not save privacy setting.")));
$("notification-preferences")?.addEventListener("submit", (event) => { event.preventDefault(); void saveNotifications().catch(() => toast("Could not save notification settings.")); });
$("direct-message")?.addEventListener("input", () => { void setTyping(true); clearTimeout(typingTimer); typingTimer = setTimeout(() => void setTyping(false), 3000); });
$("conversation-user")?.addEventListener("change", () => { watchTyping(); void loadMessageMetadata(conversationRequestId(activeConversation())); });
$("group-create-form")?.addEventListener("submit", (event) => void createGroup(event).catch(() => toast("Could not create group.")));
$("group-message-form")?.addEventListener("submit", (event) => void sendGroupMessage(event).catch(() => toast("Could not send group message.")));

onAuthStateChanged(auth, async (user) => {
  if (!user) return; viewer = user; const snapshot = await getDoc(doc(db, "users", user.uid)); profile = snapshot.exists() ? snapshot.data() : null;
  await loadPreferences().catch(() => {}); watchTyping(); const other = activeConversation(); if (other) await loadMessageMetadata(conversationRequestId(other)); loadGroups(); decorateDirectMessages();
});
