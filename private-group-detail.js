import { auth, db } from "./firebase-config.js";
import {
  invitePrivateGroupMember,
  listPrivateGroupsForMember,
  loadPrivateGroupKey,
  removePrivateGroupMember,
  grantPrivateGroupKey
} from "./private-group-firestore.mjs";
import { decryptPayload, encryptPayload } from "./e2ee-crypto.mjs";
import { ensureE2eeIdentity } from "./e2ee-identity.js";
import { createModerationClient } from "./moderation-client.mjs";
import { REPORT_REASONS } from "./moderation-policy.mjs";
import { exitAfterAuthLoss } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const params = new URLSearchParams(location.search);
const groupId = params.get("id") || "";
const privatePanel = document.getElementById("private-group-panel");
const privateStatus = document.getElementById("private-group-status");
const privateMessages = document.getElementById("private-group-messages");
const privateForm = document.getElementById("private-group-message-form");
const privateInput = document.getElementById("private-group-message");
const inviteForm = document.getElementById("private-group-invite-form");
const inviteUid = document.getElementById("private-group-invite-uid");
const membersWrap = document.getElementById("private-group-members");

let currentUser = null;
let currentGroup = null;
let currentMembership = null;
let roomKey = null;
let e2eeIdentity = null;
let moderation = null;
let messageUnsub = null;

const setStatus = (message = "") => { if (privateStatus) privateStatus.textContent = message; };
const memberPath = (uid) => doc(db, "groups", groupId, "members", uid);
const messageCollection = () => collection(db, "groups", groupId, "privateGroupMessages");
const canManage = () => currentMembership?.role === "owner" || currentMembership?.role === "moderator";

const profileLabel = async (uid) => {
  if (!uid) return "deleted";
  const snapshot = await getDoc(doc(db, "users", uid));
  return snapshot.exists() ? String(snapshot.data().username || "anonymous") : "deleted";
};

const canShowAuthor = async (uid) => {
  if (!uid || uid === currentUser?.uid) return true;
  try { return !(await moderation?.isPairBlocked(uid)); }
  catch { return false; }
};

const loadMembership = async () => {
  const membership = await getDoc(memberPath(currentUser.uid));
  currentMembership = membership.exists() ? membership.data() : null;
  if (!currentMembership) throw new Error("You are not a member of this private Group.");
};

const renderMembers = async () => {
  if (!membersWrap) return;
  const snapshot = await getDocs(collection(db, "groups", groupId, "members"));
  membersWrap.replaceChildren();
  for (const entry of snapshot.docs) {
    const member = entry.data();
    const row = document.createElement("div");
    row.className = "connection-card";
    const label = document.createElement("span");
    const role = member.role === "owner" ? "Owner" : member.role === "moderator" ? "Moderator" : "Member";
    label.textContent = `@${await profileLabel(member.uid)} · ${role}`;
    row.append(label);
    if (canManage() && member.uid !== currentUser.uid && member.role !== "owner"
        && !(currentMembership.role === "moderator" && member.role !== "member")) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove member";
      remove.onclick = async () => {
        remove.disabled = true;
        try {
          await removePrivateGroupMember(db, currentUser.uid, groupId, member.uid);
          await renderMembers();
          setStatus("Member removed from the private Group.");
        } catch (error) {
          setStatus(error?.message || "Could not remove that member.");
          remove.disabled = false;
        }
      };
      row.append(remove);
    }
    membersWrap.append(row);
  }
};

const reportSender = async (uid) => {
  if (!moderation || uid === currentUser.uid) return;
  const reason = window.prompt(`Report reason: ${REPORT_REASONS.join(", ")}`, "other");
  if (!reason) return;
  await moderation.report({
    targetKind: "user",
    targetCollection: "users",
    targetId: uid,
    reportedUserId: uid
  }, reason);
  setStatus("Report submitted for moderator review.");
};

const renderEncryptedMessages = async (docs) => {
  if (!privateMessages) return;
  privateMessages.replaceChildren();
  for (const entry of docs) {
    const data = entry.data();
    if (!(await canShowAuthor(data.senderId))) continue;
    const card = document.createElement("article");
    card.className = "post-card";
    const head = document.createElement("p");
    head.textContent = `@${await profileLabel(data.senderId)}`;
    const body = document.createElement("p");
    try {
      if (!data.encrypted || !data.bodyCipher || !roomKey) throw new Error("Encrypted message unavailable.");
      const payload = await decryptPayload(roomKey, data.bodyCipher, `private-group-message:${groupId}:${entry.id}:body`);
      body.textContent = String(payload?.text || "");
    } catch {
      body.textContent = "This encrypted message could not be opened.";
    }
    const actions = document.createElement("div");
    actions.className = "post-actions";
    if (data.senderId === currentUser.uid || canManage()) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.onclick = () => deleteDoc(entry.ref);
      actions.append(remove);
    }
    if (data.senderId !== currentUser.uid) {
      const report = document.createElement("button");
      report.type = "button";
      report.textContent = "Report";
      report.onclick = () => reportSender(data.senderId);
      actions.append(report);
    }
    card.append(head, body, actions);
    privateMessages.append(card);
  }
};

const openPrivateGroup = async () => {
  const available = await listPrivateGroupsForMember(db, currentUser.uid);
  currentGroup = available.find((group) => group.id === groupId) || null;
  if (!currentGroup || currentGroup.visibility !== "private") return;
  await loadMembership();
  if (privatePanel) privatePanel.hidden = false;
  document.getElementById("group-post-composer")?.setAttribute("hidden", "");
  const publicPosts = document.getElementById("group-posts-list");
  if (publicPosts) publicPosts.hidden = true;
  const discussionTitle = document.getElementById("group-discussion-title");
  if (discussionTitle) discussionTitle.textContent = "Private Group";

  e2eeIdentity = await ensureE2eeIdentity(db, currentUser);
  roomKey = await loadPrivateGroupKey(db, currentUser, groupId);
  if (!roomKey) throw new Error("This private Group's encryption key is not available on this device.");
  await renderMembers();

  messageUnsub?.();
  messageUnsub = onSnapshot(query(messageCollection(), orderBy("createdAt", "asc"), limit(100)), (snapshot) => {
    void renderEncryptedMessages(snapshot.docs);
  });
  setStatus("Encrypted private Group opened.");
};

privateForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = String(privateInput?.value || "").trim().slice(0, 1000);
  if (!text || !currentMembership || !roomKey) return;
  const messageRef = doc(messageCollection());
  const bodyCipher = await encryptPayload(roomKey, { text }, `private-group-message:${groupId}:${messageRef.id}:body`);
  await setDoc(messageRef, {
    senderId: currentUser.uid,
    encrypted: true,
    cipherVersion: 1,
    bodyCipher,
    createdAt: serverTimestamp()
  });
  privateInput.value = "";
  setStatus("Encrypted message sent.");
});

inviteForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const targetUid = String(inviteUid?.value || "").trim();
  if (!targetUid || !canManage()) return;
  try {
    await invitePrivateGroupMember(db, currentUser, groupId, targetUid);
    await grantPrivateGroupKey(db, currentUser, groupId, targetUid);
    inviteUid.value = "";
    await renderMembers();
    setStatus("Member invited to the encrypted private Group.");
  } catch (error) {
    setStatus(error?.message || "Could not invite that member.");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    messageUnsub?.();
    moderation?.destroy?.();
    await exitAfterAuthLoss();
    return;
  }
  currentUser = user;
  moderation = createModerationClient({
    db,
    firestore: { deleteDoc, doc, getDoc, setDoc, writeBatch },
    currentUid: user.uid,
    timestamp: serverTimestamp
  });
  try { await openPrivateGroup(); }
  catch (error) { setStatus(error?.message || "Could not open this private Group."); }
});

addEventListener("pagehide", () => {
  messageUnsub?.();
  moderation?.destroy?.();
});
