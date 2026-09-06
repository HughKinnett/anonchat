import { auth, db } from "./firebase-config.js";
import { canUnsendMessage } from "./private-message-visibility-policy.mjs";
import { canonicalConversationId } from "./private-conversation-id.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, deleteField, doc, limit, onSnapshot, orderBy, query, serverTimestamp,
  setDoc, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const conversation = $("conversation-user");
const stream = $("direct-messages");
const deleteChat = $("delete-chat");

let currentUser = null;
let messageDocs = [];
let hiddenMessageIds = new Set();
let stopMessages = () => {};
let stopVisibility = () => {};
let observer = null;

const visibilityIdFor = (messageId) => `${messageId}_${currentUser.uid}`;

const activeMessages = () => {
  const now = Date.now();
  return messageDocs.filter((message) => {
    const expiresAt = message.data().expiresAt?.toMillis?.();
    return !Number.isFinite(expiresAt) || expiresAt > now;
  }).sort((left, right) => {
    const leftAt = left.data().createdAt?.toMillis?.() || 0;
    const rightAt = right.data().createdAt?.toMillis?.() || 0;
    return leftAt - rightAt || left.id.localeCompare(right.id);
  });
};

const hideMessageForMe = async (messageId) => {
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid || !messageId) return;
  await setDoc(doc(db, "messageRequests", canonicalConversationId(currentUser.uid, otherUid), "messageVisibility", visibilityIdFor(messageId)), {
    messageId,
    uid: currentUser.uid,
    hiddenAt: serverTimestamp()
  });
};

const unsendForEveryone = async (message) => {
  if (!currentUser || !message) return;
  const data = message.data();
  if (!canUnsendMessage({ currentUid: currentUser.uid, senderId: data.senderId, unsentAt: data.unsentAt })) return;
  await updateDoc(message.ref, {
    unsentAt: serverTimestamp(),
    unsentBy: currentUser.uid,
    bodyCipher: deleteField(),
    imageCipher: deleteField(),
    text: deleteField(),
    imageData: deleteField()
  });
};

const decorate = () => {
  if (!stream || !currentUser) return;
  const messages = activeMessages();
  const bubbles = [...stream.querySelectorAll(".private-chat-bubble")];
  bubbles.forEach((bubble, index) => {
    const message = messages[index];
    if (!message) return;
    const data = message.data();
    bubble.dataset.messageId = message.id;
    bubble.hidden = hiddenMessageIds.has(message.id);
    bubble.querySelector(":scope > .private-visibility-actions")?.remove();
    if (bubble.hidden) return;

    const actions = document.createElement("div");
    actions.className = "private-visibility-actions";
    const hide = document.createElement("button");
    hide.type = "button";
    hide.textContent = "Delete for me";
    hide.addEventListener("click", async () => {
      hide.disabled = true;
      try { await hideMessageForMe(message.id); }
      catch { hide.disabled = false; }
    });
    actions.append(hide);

    if (canUnsendMessage({ currentUid: currentUser.uid, senderId: data.senderId, unsentAt: data.unsentAt })) {
      const unsend = document.createElement("button");
      unsend.type = "button";
      unsend.textContent = "Unsend for everyone";
      unsend.addEventListener("click", async () => {
        unsend.disabled = true;
        try { await unsendForEveryone(message); }
        catch { unsend.disabled = false; }
      });
      actions.append(unsend);
    }
    bubble.append(actions);
  });
};

const hideLoadedChatForMe = async () => {
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid) return;
  const visible = activeMessages().filter((message) => !hiddenMessageIds.has(message.id));
  for (let offset = 0; offset < visible.length; offset += 400) {
    const batch = writeBatch(db);
    visible.slice(offset, offset + 400).forEach((message) => {
      batch.set(doc(db, "messageRequests", canonicalConversationId(currentUser.uid, otherUid), "messageVisibility", visibilityIdFor(message.id)), {
        messageId: message.id,
        uid: currentUser.uid,
        hiddenAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
};

const watchConversation = () => {
  stopMessages();
  stopVisibility();
  stopMessages = () => {};
  stopVisibility = () => {};
  messageDocs = [];
  hiddenMessageIds = new Set();
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid) return;
  const pairId = canonicalConversationId(currentUser.uid, otherUid);
  stopMessages = onSnapshot(
    query(collection(db, "messageRequests", pairId, "messages"), orderBy("createdAt", "desc"), limit(100)),
    (snapshot) => { messageDocs = snapshot.docs; decorate(); },
    () => { messageDocs = []; decorate(); }
  );
  stopVisibility = onSnapshot(
    query(collection(db, "messageRequests", pairId, "messageVisibility"), where("uid", "==", currentUser.uid), limit(500)),
    (snapshot) => {
      hiddenMessageIds = new Set(snapshot.docs.map((entry) => entry.data().messageId));
      decorate();
    },
    () => { hiddenMessageIds = new Set(); decorate(); }
  );
};

// Capture the existing chat-delete control before its legacy target listener can run.
document.addEventListener("click", (event) => {
  if (event.target !== deleteChat) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void hideLoadedChatForMe();
}, true);

const observeStream = () => {
  observer?.disconnect();
  observer = stream ? new MutationObserver(() => decorate()) : null;
  observer?.observe(stream, { childList: true });
};

observeStream();
conversation?.addEventListener("change", watchConversation);

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (deleteChat) deleteChat.textContent = "Delete chat for me";
  watchConversation();
});

addEventListener("pagehide", (event) => {
  stopMessages();
  stopVisibility();
  stopMessages = () => {};
  stopVisibility = () => {};
  observer?.disconnect();
  if (event.persisted) return;
  observer = null;
});

addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  observeStream();
  watchConversation();
});
