import { auth, db } from "./firebase-config.js";
import { typingExpiresAt, isTypingActive } from "./private-message-typing-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const input = $("direct-message");
const conversation = $("conversation-user");
const status = $("direct-typing-status");

let currentUser = null;
let stopRemoteTyping = () => {};
let stopTimer = 0;
let refreshTimer = 0;
let lastWriteAt = 0;

const pairIdFor = (otherUid) => [currentUser?.uid, otherUid].filter(Boolean).sort().join("_");
const ownTypingRef = (otherUid) => doc(db, "messageRequests", pairIdFor(otherUid), "typing", currentUser.uid);

const clearOwnTyping = async () => {
  window.clearTimeout(stopTimer);
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid) return;
  try { await deleteDoc(ownTypingRef(otherUid)); } catch { /* Expiry is authoritative. */ }
};

const writeTyping = async () => {
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid || !input?.value.trim()) return clearOwnTyping();
  const nowMs = Date.now();
  if (nowMs - lastWriteAt < 900) return;
  lastWriteAt = nowMs;
  await setDoc(ownTypingRef(otherUid), {
    uid: currentUser.uid,
    expiresAt: Timestamp.fromMillis(typingExpiresAt(nowMs)),
    updatedAt: serverTimestamp()
  });
  window.clearTimeout(stopTimer);
  stopTimer = window.setTimeout(() => { void clearOwnTyping(); }, 1800);
};

const renderRemoteTyping = (snapshot) => {
  if (!status) return;
  const data = snapshot.exists() ? snapshot.data() : null;
  const expiresAt = data?.expiresAt?.toMillis?.() ?? data?.expiresAt;
  const active = isTypingActive({ expiresAt }, Date.now());
  const label = conversation?.selectedOptions?.[0]?.textContent || "This user";
  status.textContent = active ? `${label} is typing…` : "";
  status.hidden = !active;
};

const watchConversation = () => {
  stopRemoteTyping();
  stopRemoteTyping = () => {};
  window.clearInterval(refreshTimer);
  refreshTimer = 0;
  if (status) { status.textContent = ""; status.hidden = true; }
  const otherUid = conversation?.value;
  if (!currentUser || !otherUid) return;
  const remoteRef = doc(db, "messageRequests", pairIdFor(otherUid), "typing", otherUid);
  let latest = null;
  stopRemoteTyping = onSnapshot(remoteRef, (snapshot) => {
    latest = snapshot;
    renderRemoteTyping(snapshot);
  }, () => {
    if (status) { status.textContent = ""; status.hidden = true; }
  });
  refreshTimer = window.setInterval(() => { if (latest) renderRemoteTyping(latest); }, 1000);
};

input?.addEventListener("input", () => { void writeTyping(); });
input?.addEventListener("blur", () => { void clearOwnTyping(); });
conversation?.addEventListener("change", () => {
  void clearOwnTyping();
  watchConversation();
});

document.addEventListener("submit", (event) => {
  if (event.target?.id === "direct-message-form") void clearOwnTyping();
}, true);

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  watchConversation();
});

addEventListener("pagehide", (event) => {
  stopRemoteTyping();
  stopRemoteTyping = () => {};
  window.clearInterval(refreshTimer);
  refreshTimer = 0;
  void clearOwnTyping();
  if (event.persisted && status) { status.textContent = ""; status.hidden = true; }
});

addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  watchConversation();
});
