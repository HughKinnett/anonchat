import { auth, db } from "./firebase-config.js";
import { MESSAGE_REACTIONS, nextMessageReaction } from "./private-message-reaction-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const conversation = $("conversation-user");
const stream = $("direct-messages");

let currentUser = null;
let messageDocs = [];
let reactionDocs = [];
let stopMessages = () => {};
let stopReactions = () => {};
let observer = null;

const pairIdFor = (otherUid) => [currentUser?.uid, otherUid].filter(Boolean).sort().join("_");
const reactionIdFor = (messageId) => `${messageId}_${currentUser.uid}`;

const activeMessageDocs = () => {
  const now = Date.now();
  return messageDocs.filter((message) => {
    const data = message.data();
    const expiresAt = data.expiresAt?.toMillis?.();
    return !Number.isFinite(expiresAt) || expiresAt > now;
  }).sort((left, right) => {
    const leftAt = left.data().createdAt?.toMillis?.() || 0;
    const rightAt = right.data().createdAt?.toMillis?.() || 0;
    return leftAt - rightAt || left.id.localeCompare(right.id);
  });
};

const reactionFor = (messageId, uid) => reactionDocs.find((entry) => {
  const data = entry.data();
  return data.messageId === messageId && data.uid === uid;
})?.data()?.type || null;

const countsFor = (messageId) => MESSAGE_REACTIONS.map((type) => ({
  type,
  count: reactionDocs.filter((entry) => {
    const data = entry.data();
    return data.messageId === messageId && data.type === type;
  }).length
}));

const toggleReaction = async (messageId, selected) => {
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid || !messageId) return;
  const current = reactionFor(messageId, currentUser.uid);
  const next = nextMessageReaction(current, selected);
  const reference = doc(db, "messageRequests", pairIdFor(otherUid), "messageReactions", reactionIdFor(messageId));
  if (!next) {
    await deleteDoc(reference);
    return;
  }
  await setDoc(reference, {
    messageId,
    uid: currentUser.uid,
    type: next,
    updatedAt: serverTimestamp()
  });
};

const decorate = () => {
  if (!stream || !currentUser) return;
  const bubbles = [...stream.querySelectorAll(".private-chat-bubble")];
  const messages = activeMessageDocs();
  bubbles.forEach((bubble, index) => {
    const message = messages[index];
    if (!message) return;
    bubble.setAttribute("data-message-id", message.id);
    bubble.querySelector(":scope > .private-message-reactions")?.remove();

    const bar = document.createElement("div");
    bar.className = "private-message-reactions";
    bar.setAttribute("aria-label", "React to message");
    const current = reactionFor(message.id, currentUser.uid);
    countsFor(message.id).forEach(({ type, count }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "private-message-reaction";
      button.textContent = count ? `${type} ${count}` : type;
      button.title = `React ${type}`;
      button.setAttribute("aria-label", count ? `${type}, ${count} reaction${count === 1 ? "" : "s"}` : `React ${type}`);
      button.setAttribute("aria-pressed", String(current === type));
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await toggleReaction(message.id, type); }
        catch { button.disabled = false; }
      });
      bar.append(button);
    });
    bubble.append(bar);
  });
};

const stopConversation = () => {
  stopMessages();
  stopReactions();
  stopMessages = () => {};
  stopReactions = () => {};
  messageDocs = [];
  reactionDocs = [];
  decorate();
};

const watchConversation = () => {
  stopConversation();
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid) return;
  const pairId = pairIdFor(otherUid);
  stopMessages = onSnapshot(
    query(collection(db, "messageRequests", pairId, "messages"), orderBy("createdAt", "desc"), limit(100)),
    (snapshot) => { messageDocs = snapshot.docs; decorate(); },
    () => { messageDocs = []; decorate(); }
  );
  stopReactions = onSnapshot(
    query(collection(db, "messageRequests", pairId, "messageReactions"), orderBy("updatedAt", "desc"), limit(500)),
    (snapshot) => { reactionDocs = snapshot.docs; decorate(); },
    () => { reactionDocs = []; decorate(); }
  );
};

const observeStream = () => {
  observer?.disconnect();
  observer = stream ? new MutationObserver(() => decorate()) : null;
  observer?.observe(stream, { childList: true });
};

observeStream();
conversation?.addEventListener("change", watchConversation);

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  watchConversation();
});

addEventListener("pagehide", (event) => {
  stopConversation();
  observer?.disconnect();
  if (event.persisted) return;
  observer = null;
});

addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  observeStream();
  watchConversation();
});
