import { auth, db } from "./firebase-config.js";
import { resolveReplyPreview } from "./private-message-reply-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, limit, onSnapshot, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const conversation = $("conversation-user");
const stream = $("direct-messages");
const form = $("direct-message-form");

let currentUser = null;
let messageDocs = [];
let stopMessages = () => {};
let observer = null;
let composerPreview = null;

const pairIdFor = (otherUid) => [currentUser?.uid, otherUid].filter(Boolean).sort().join("_");

const activeMessages = () => {
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

const ensureComposerPreview = () => {
  if (!form) return null;
  if (composerPreview?.isConnected) return composerPreview;
  const box = document.createElement("div");
  box.className = "private-reply-composer-preview";
  box.hidden = true;
  const text = document.createElement("span");
  text.className = "private-reply-composer-text";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel reply";
  cancel.addEventListener("click", () => clearReply());
  box.append(text, cancel);
  form.prepend(box);
  composerPreview = box;
  return box;
};

const clearReply = () => {
  if (!form) return;
  delete form.dataset.replyToMessageId;
  delete form.dataset.replyToSenderId;
  const box = ensureComposerPreview();
  if (box) {
    box.hidden = true;
    box.querySelector(".private-reply-composer-text").textContent = "";
  }
};

const selectReply = (message, bubble) => {
  if (!form || !message) return;
  const data = message.data();
  form.dataset.replyToMessageId = message.id;
  form.dataset.replyToSenderId = data.senderId;
  const sender = bubble.querySelector("small")?.textContent || "Message";
  const snippet = bubble.querySelector(":scope > span:not(.private-message-actions)")?.textContent?.trim() || "Photo message";
  const box = ensureComposerPreview();
  box.querySelector(".private-reply-composer-text").textContent = `Replying to ${sender}: ${snippet.slice(0, 120)}`;
  box.hidden = false;
  $("direct-message")?.focus();
};

const renderReplyQuote = (bubble, message, byId, bubbleById) => {
  bubble.querySelector(":scope > .private-reply-preview")?.remove();
  const data = message.data();
  if (!data.replyToMessageId) return;
  const originalMessage = byId.get(data.replyToMessageId);
  const originalBubble = bubbleById.get(data.replyToMessageId);
  const originalHidden = originalBubble?.hidden === true;
  const originalText = originalHidden ? "" : originalBubble?.querySelector(":scope > span:not(.private-message-actions)")?.textContent?.trim() || "";
  const originalSender = originalHidden ? "" : originalBubble?.querySelector("small")?.textContent || data.replyToSenderId || "";
  const preview = resolveReplyPreview(data, originalMessage && !originalHidden ? {
    senderId: originalSender,
    text: originalText,
    unsentAt: originalMessage.data().unsentAt || null
  } : null);

  const quote = document.createElement("button");
  quote.type = "button";
  quote.className = "private-reply-preview";
  quote.textContent = preview.state === "available"
    ? `${originalSender}: ${preview.snippet.slice(0, 120)}`
    : "Original message unavailable.";
  quote.addEventListener("click", () => {
    const target = stream?.querySelector(`[data-message-id="${CSS.escape(data.replyToMessageId)}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.classList.add("reply-target-highlight");
    window.setTimeout(() => target?.classList.remove("reply-target-highlight"), 1200);
  });
  bubble.prepend(quote);
};

const decorate = () => {
  if (!stream || !currentUser) return;
  const messages = activeMessages();
  const bubbles = [...stream.querySelectorAll(".private-chat-bubble")];
  const byId = new Map(messages.map((message) => [message.id, message]));
  const bubbleById = new Map();

  bubbles.forEach((bubble, index) => {
    const message = messages[index];
    if (!message) return;
    bubble.setAttribute("data-message-id", message.id);
    bubbleById.set(message.id, bubble);
    bubble.querySelector(":scope > .private-reply-action")?.remove();
    const reply = document.createElement("button");
    reply.type = "button";
    reply.className = "private-reply-action";
    reply.textContent = "Reply";
    reply.addEventListener("click", () => selectReply(message, bubble));
    bubble.append(reply);
  });

  bubbles.forEach((bubble, index) => {
    const message = messages[index];
    if (message) renderReplyQuote(bubble, message, byId, bubbleById);
  });
};

const watchConversation = () => {
  stopMessages();
  stopMessages = () => {};
  messageDocs = [];
  clearReply();
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid) return;
  stopMessages = onSnapshot(
    query(collection(db, "messageRequests", pairIdFor(otherUid), "messages"), orderBy("createdAt", "desc"), limit(100)),
    (snapshot) => { messageDocs = snapshot.docs; decorate(); },
    () => { messageDocs = []; decorate(); }
  );
};

const observeStream = () => {
  observer?.disconnect();
  observer = stream ? new MutationObserver(() => decorate()) : null;
  observer?.observe(stream, { childList: true });
};

ensureComposerPreview();
observeStream();
conversation?.addEventListener("change", watchConversation);
form?.addEventListener("submit", () => window.setTimeout(clearReply, 0));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  watchConversation();
});

addEventListener("pagehide", (event) => {
  stopMessages();
  stopMessages = () => {};
  observer?.disconnect();
  if (event.persisted) return;
  observer = null;
});

addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  observeStream();
  watchConversation();
});
