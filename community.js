import { auth, db } from "./firebase-config.js";
import { messageRequestButtonAction, messageRequestButtonState } from "./message-request-policy.mjs";
import { recordPageActivity } from "./activity-integration.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { canShowActorContent, reportId, roomReportPayloads, roomState } from "./moderation-policy.mjs";
import {
  createAuthoritativeRoomReportTracker,
  createRoomExpiryController,
  createRoomReportSubmissionGate,
  openRoomAfterMembershipWrite,
  roomMessageView,
  roomViewState
} from "./room-report-ui-policy.mjs";
import { filterAccessibleDirectMessages, isBlockedPair, loadBlockPairs } from "./block-integration.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, onSnapshot, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const state = {
  user: null, profile: null, privateDetails: {}, users: [], rooms: [], roomMessages: [],
  roomMemberships: [], requests: [], requestsLoaded: false, requestBusy: false,
  messages: [], reveals: [], preferences: null, activeRoom: "", blockPairs: new Set(), blockPairsInitialized: false
};
const listeners = [];
const locallyReportedRooms = createAuthoritativeRoomReportTracker();
const submittedRoomReportIds = new Set();
const roomReportDialog = $("room-report-dialog");
const roomReportForm = $("room-report-form");
const roomReportSubmissionGate = createRoomReportSubmissionGate();
let dialogRoomReportToken = null;
let submittingRoomReportToken = null;
let roomMessageUnsubscribe = null;
const roomExpiryController = createRoomExpiryController({
  onExpire: () => {
    renderRooms();
    renderRoomMessages();
  }
});
const setStatus = (text, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("danger", error);
};
const setRequestStatus = (text, error = false) => {
  $("request-status").textContent = text;
  $("request-status").classList.toggle("danger", error);
};
const userName = (uid) => state.users.find((entry) => entry.id === uid)?.data().username || "anonymous";
const now = () => Date.now();
const aggressive = /\b(fuck|bitch|kill|hate|stupid|idiot|dumb|worthless|shut up)\b/i;
const safeToSend = (text) => !state.preferences?.contextCheck || !aggressive.test(text) ||
  window.confirm("This may come across as aggressive. Do you want to send it as written?");
const actorIsVisible = (uid) => uid === state.user?.uid || (state.blockPairsInitialized && canShowActorContent(uid, state.blockPairs));
const canInteractWith = (uid) => uid === state.user?.uid || (state.blockPairsInitialized && !isBlockedPair(state.user?.uid, uid, state.blockPairs));

const selectPanel = (panelId) => {
  const chosen = document.getElementById(panelId) ? panelId : "rooms-panel";
  document.querySelectorAll('[role="tab"]').forEach((button) =>
    button.setAttribute("aria-selected", String(button.dataset.panel === chosen))
  );
  document.querySelectorAll('[role="tabpanel"]').forEach((panel) => {
    panel.hidden = panel.id !== chosen;
  });
};

document.querySelectorAll('[role="tab"]').forEach((button) => button.addEventListener("click", () => {
  selectPanel(button.dataset.panel);
  history.replaceState(null, "", `#${button.dataset.panel}`);
}));
selectPanel(location.hash.slice(1));

$("sign-out").addEventListener("click", async () => {
  await exitAuthenticatedSession({
    user: state.user,
    stopListeners: () => {
      roomExpiryController.cancel();
      roomMessageUnsubscribe?.();
      listeners.forEach((unsubscribe) => unsubscribe());
    },
    redirect: () => location.replace("index.html")
  });
});

const renderIdentity = () => {
  if (!state.profile) return;
  const card = $("identity-card");
  card.replaceChildren();
  const name = document.createElement("strong");
  name.textContent = `@${state.profile.username}`;
  const trust = document.createElement("span");
  trust.className = "trust";
  trust.textContent = "◆ Private community member";
  const note = document.createElement("span");
  note.textContent = "Email hidden · private details controlled by you";
  card.append(name, trust, note);
};

const aliasFor = (roomId) => {
  const key = `anonchat-room-alias-${roomId}`;
  let alias = localStorage.getItem(key);
  if (!alias) {
    const first = ["Quiet", "Silver", "Hidden", "Brave", "Kind", "Midnight", "Electric"];
    const second = ["Fox", "Owl", "River", "Comet", "Panda", "Echo", "Wolf"];
    alias = first[Math.floor(Math.random() * first.length)] + second[Math.floor(Math.random() * second.length)] + Math.floor(10 + Math.random() * 90);
    localStorage.setItem(key, alias);
  }
  return alias;
};

const joinedRoom = (roomId) => state.roomMemberships.some((member) => member.id === `${roomId}_${state.user.uid}`);
const roomDocumentView = (room) => roomViewState({
  room: room?.data?.(),
  currentUid: state.user?.uid,
  now: now(),
  locallyReported: locallyReportedRooms.isHeld(room?.id)
});

const scheduleRoomExpiryRefresh = () => {
  const activeRoom = state.rooms.find((room) => room.id === state.activeRoom)?.data();
  roomExpiryController.schedule([
    ...state.rooms.map((room) => room.data().expiresAt?.toMillis?.()),
    ...state.roomMessages.map((message) => roomMessageView({
      room: activeRoom,
      message: message.data(),
      now: now()
    }).expirationMillis)
  ]);
};

const stopRoomMessages = () => {
  roomMessageUnsubscribe?.();
  roomMessageUnsubscribe = null;
  state.roomMessages = [];
};

const closeActiveRoom = (message = "") => {
  roomExpiryController.cancel();
  const dialog = $("room-dialog");
  if (dialog.open) dialog.close();
  state.activeRoom = "";
  stopRoomMessages();
  scheduleRoomExpiryRefresh();
  if (message) setStatus(message, true);
};

const listenToRoomMessages = (roomId) => {
  stopRoomMessages();
  roomMessageUnsubscribe = onSnapshot(
    query(collection(db, "roomMessages"), where("roomId", "==", roomId)),
    (snapshot) => {
      if (state.activeRoom !== roomId) return;
      state.roomMessages = snapshot.docs;
      renderRoomMessages();
    },
    () => {
      if (state.activeRoom === roomId) closeActiveRoom("This room is no longer available.");
    }
  );
};

const reconcileRoomAvailability = () => {
  if (state.activeRoom) {
    const room = state.rooms.find((entry) => entry.id === state.activeRoom);
    if (!room || roomState(room.data(), now()) !== "active" || !roomDocumentView(room).canInteract) {
      closeActiveRoom("This room is no longer available.");
    }
  }
  const pendingRoomId = dialogRoomReportToken?.request.roomId;
  if (pendingRoomId && !state.rooms.some((entry) =>
    entry.id === pendingRoomId && roomDocumentView(entry).canReport
  )) {
    roomReportSubmissionGate.finish(dialogRoomReportToken);
    dialogRoomReportToken = null;
    if (roomReportDialog.open) roomReportDialog.close();
    setStatus("This room is no longer available.", true);
  }
};

const renderRooms = () => {
  const rooms = state.rooms
    .filter((room) => actorIsVisible(room.data().ownerId) && roomDocumentView(room).visible)
    .sort((left, right) =>
      (right.data().createdAt?.toMillis?.() || 0) - (left.data().createdAt?.toMillis?.() || 0)
    );
  $("room-list").replaceChildren(...rooms.map((room) => {
    const data = room.data();
    const view = roomDocumentView(room);
    const card = document.createElement("article");
    card.className = "list-card card-row";
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = data.name;
    const topic = document.createElement("p");
    topic.className = "muted";
    topic.textContent = data.topic;
    copy.append(heading, topic);
    const actions = document.createElement("div");
    actions.className = "room-actions";
    const enter = document.createElement("button");
    enter.className = "primary";
    enter.textContent = joinedRoom(room.id) ? "Open room" : "Join anonymously";
    enter.addEventListener("click", () => openRoom(room.id, data.name));
    actions.append(enter);
    if (view.canReport) {
      const report = document.createElement("button");
      report.className = "report-room-button";
      report.type = "button";
      report.textContent = "Report Room";
      report.addEventListener("click", () => openRoomReportDialog(room, report));
      actions.append(report);
    }
    card.append(copy, actions);
    return card;
  }));
  reconcileRoomAvailability();
  scheduleRoomExpiryRefresh();
};

const openRoom = async (id, name) => {
  const room = state.rooms.find((entry) => entry.id === id);
  const view = roomDocumentView(room);
  if (!room || !view.canInteract || !canInteractWith(room.data().ownerId)) return;
  try {
    await openRoomAfterMembershipWrite({
      getRoom: async () => {
        const latest = await getDoc(doc(db, "rooms", id));
        return latest.exists() ? latest : null;
      },
      canOpen: (latest) => {
        const latestView = roomDocumentView(latest);
        return latestView.canInteract && canInteractWith(latest.data().ownerId);
      },
      writeMembership: () => setDoc(doc(db, "roomMembers", `${id}_${state.user.uid}`), {
        roomId: id, uid: state.user.uid, joinedAt: serverTimestamp()
      }, { merge: true }),
      onOpen: (latest) => {
        state.activeRoom = id;
        $("room-title").textContent = latest.data().name || name;
        $("room-alias").textContent = `You are ${aliasFor(id)}`;
        listenToRoomMessages(id);
        renderRoomMessages();
        scheduleRoomExpiryRefresh();
        $("room-dialog").showModal();
      },
      onUnavailable: () => setStatus("This room is no longer available.", true)
    });
  } catch {
    setStatus("Could not join that room.", true);
  }
};

$("room-dialog").querySelector(".dialog-close").addEventListener("click", () => closeActiveRoom());
$("room-dialog").addEventListener("close", () => {
  if (state.activeRoom) closeActiveRoom();
});

const renderRoomMessages = () => {
  const room = state.rooms.find((entry) => entry.id === state.activeRoom);
  const messages = state.roomMessages
    .filter((message) => message.data().roomId === state.activeRoom && actorIsVisible(message.data().senderId))
    .map((message) => ({
      message,
      view: roomMessageView({ room: room?.data(), message: message.data(), now: now() })
    }))
    .filter(({ view }) => view.visible)
    .sort((left, right) =>
      (left.message.data().createdAt?.toMillis?.() || 0) - (right.message.data().createdAt?.toMillis?.() || 0)
    );
  $("room-messages").replaceChildren(...messages.map(({ message, view }) => {
    const data = message.data();
    const item = document.createElement("div");
    item.className = `message${data.senderId === state.user.uid ? " mine" : ""}`;
    const sender = document.createElement("small");
    sender.textContent = data.tempName;
    const text = document.createElement("span");
    text.textContent = data.text;
    const expiration = document.createElement("time");
    expiration.className = "message-expiration";
    if (Number.isFinite(view.expirationMillis) && !view.retainedForReview) {
      expiration.dateTime = new Date(view.expirationMillis).toISOString();
    }
    expiration.textContent = view.expirationText;
    item.append(sender, text, expiration);
    return item;
  }));
  $("room-messages").scrollTop = $("room-messages").scrollHeight;
  scheduleRoomExpiryRefresh();
};

$("room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const made = await addDoc(collection(db, "rooms"), {
      name: $("room-name").value.trim(), topic: $("room-topic").value.trim(),
      ownerId: state.user.uid, moderationStatus: "active", createdAt: serverTimestamp()
    });
    await setDoc(doc(db, "roomMembers", `${made.id}_${state.user.uid}`), {
      roomId: made.id, uid: state.user.uid, joinedAt: serverTimestamp()
    });
    event.target.reset();
    setStatus("Temporary room started.");
  } catch {
    setStatus("Could not start room.", true);
  }
});

$("room-message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("room-message").value.trim();
  const room = state.rooms.find((entry) => entry.id === state.activeRoom);
  const view = roomDocumentView(room);
  if (!view.canInteract) return;
  if (!text || !room || !canInteractWith(room.data().ownerId) || !safeToSend(text)) return;
  try {
    await addDoc(collection(db, "roomMessages"), {
      roomId: state.activeRoom, senderId: state.user.uid, tempName: aliasFor(state.activeRoom), text,
      expiresAt: Timestamp.fromMillis(now() + 86400000), createdAt: serverTimestamp()
    });
    event.target.reset();
  } catch {
    setStatus("Could not send room message.", true);
  }
});

const openRoomReportDialog = (room, button) => {
  const view = roomDocumentView(room);
  const reportKey = reportId("room", room.id, state.user.uid);
  if (roomReportSubmissionGate.isBusy()) {
    setStatus("Another room report is still being submitted. Please wait.");
    return;
  }
  if (!view.canReport || submittedRoomReportIds.has(reportKey)) {
    button.disabled = true;
    return;
  }
  dialogRoomReportToken = roomReportSubmissionGate.tryStart({
    roomId: room.id,
    ownerId: room.data().ownerId,
    reportKey,
    button
  });
  if (!dialogRoomReportToken) return;
  roomReportForm.reset();
  roomReportDialog.showModal();
};

$("cancel-room-report").addEventListener("click", () => {
  if (dialogRoomReportToken) roomReportSubmissionGate.finish(dialogRoomReportToken);
  dialogRoomReportToken = null;
  roomReportDialog.close();
});

roomReportDialog.addEventListener("close", () => {
  if (dialogRoomReportToken && dialogRoomReportToken !== submittingRoomReportToken) {
    roomReportSubmissionGate.finish(dialogRoomReportToken);
    dialogRoomReportToken = null;
  }
});

roomReportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!dialogRoomReportToken || submittingRoomReportToken) return;
  const reason = new FormData(roomReportForm).get("reason");
  if (typeof reason !== "string" || !reason) return;

  const token = dialogRoomReportToken;
  const { roomId, ownerId, reportKey, button } = token.request;
  const room = state.rooms.find((entry) => entry.id === roomId);
  if (!room || !roomDocumentView(room).canReport) {
    roomReportSubmissionGate.finish(token);
    dialogRoomReportToken = null;
    roomReportDialog.close();
    setStatus("This room is no longer available.", true);
    return;
  }

  const timestamp = serverTimestamp();
  const payloads = roomReportPayloads({
    roomId,
    reporterId: state.user.uid,
    ownerId,
    reason,
    timestamp
  });
  const batch = writeBatch(db);
  batch.set(doc(db, "reports", reportKey), payloads.report);
  batch.update(doc(db, "rooms", roomId), payloads.room);

  submittingRoomReportToken = token;
  dialogRoomReportToken = null;
  button.disabled = true;
  button.textContent = "Reported";
  submittedRoomReportIds.add(reportKey);
  locallyReportedRooms.start(roomId);
  roomReportDialog.close();
  if (state.activeRoom === roomId) closeActiveRoom();
  renderRooms();
  try {
    await batch.commit();
    locallyReportedRooms.commit(roomId);
    renderRooms();
    setStatus("Room reported and suspended. Expiration paused for admin review.");
  } catch {
    submittedRoomReportIds.delete(reportKey);
    locallyReportedRooms.fail(roomId);
    button.disabled = false;
    button.textContent = "Report Room";
    renderRooms();
    setStatus("Could not report that room. It may already be under review.", true);
  } finally {
    roomReportSubmissionGate.finish(token);
    if (submittingRoomReportToken === token) submittingRoomReportToken = null;
  }
});

const requestFor = (other) => state.requests.find((request) =>
  [request.data().fromId, request.data().toId].includes(state.user.uid) &&
  [request.data().fromId, request.data().toId].includes(other)
);
const acceptedUsers = () => state.users.filter((user) =>
  user.id !== state.user.uid && actorIsVisible(user.id) && requestFor(user.id)?.data().status === "accepted"
);

const createMessageRequest = (to) => {
  const id = [state.user.uid, to].sort().join("_");
  return setDoc(doc(db, "messageRequests", id), {
    fromId: state.user.uid, toId: to, status: "pending", createdAt: serverTimestamp()
  });
};

const renderMessageUsers = () => {
  const selectedUser = $("message-user").value;
  const others = state.users.filter((user) => user.id !== state.user.uid && actorIsVisible(user.id));
  $("message-user").replaceChildren(...others.map((user) => new Option(`@${user.data().username}`, user.id)));
  if (others.some((user) => user.id === selectedUser)) $("message-user").value = selectedUser;
  $("conversation-user").replaceChildren(...acceptedUsers().map((user) => new Option(`@${user.data().username}`, user.id)));
  $("direct-message-form").hidden = !acceptedUsers().length;
  renderRequestAction();
  renderDirectMessages();
  renderReveals();
};

const renderRequestAction = ({ preserveStatus = false } = {}) => {
  const to = $("message-user").value;
  if (!state.requestsLoaded) {
    $("request-chat").textContent = "Loading requests…";
    $("request-chat").disabled = true;
    $("request-chat").setAttribute("aria-busy", "true");
    setRequestStatus("Checking existing requests…");
    return;
  }
  if (state.requestBusy || (to && !canInteractWith(to))) return;
  const existing = to ? requestFor(to) : null;
  const view = messageRequestButtonState(existing?.data(), state.user.uid);
  $("request-chat").textContent = view.label;
  $("request-chat").disabled = view.disabled;
  $("request-chat").removeAttribute("aria-busy");
  if (!preserveStatus) setRequestStatus(to ? view.hint : "Choose a user to request a conversation.", !to);
};

$("message-user").addEventListener("change", () => renderRequestAction());

$("request-chat").addEventListener("click", async () => {
  if (state.requestBusy || !state.requestsLoaded) return;
  const to = $("message-user").value;
  if (!to || !canInteractWith(to)) {
    setRequestStatus("Choose a user to request a conversation.", true);
    return;
  }
  const existing = requestFor(to);
  const initialAction = existing ? messageRequestButtonAction(existing.data(), state.user.uid) : "create";
  state.requestBusy = true;
  $("message-user").disabled = true;
  $("request-chat").disabled = true;
  $("request-chat").setAttribute("aria-busy", "true");
  $("request-chat").textContent = initialAction === "accept-incoming" ? "Accepting…" : "Sending…";
  let succeeded = false;
  try {
    if (existing) {
      const action = initialAction;
      if (action === "accepted") {
        setRequestStatus("You already have an accepted conversation with this user.");
        return;
      }
      if (action === "outgoing-pending") {
        setRequestStatus("Request sent. Waiting for this user to accept or decline.");
        return;
      }
      if (action === "accept-incoming") {
        await updateDoc(existing.ref, { status: "accepted", respondedAt: serverTimestamp() });
        succeeded = true;
        $("request-chat").textContent = "Conversation accepted";
        setRequestStatus("Conversation accepted. You can message this user now.");
        return;
      }
      if (action !== "retry") {
        setRequestStatus("This conversation request cannot be changed.", true);
        return;
      }
      await updateDoc(existing.ref, {
        fromId: state.user.uid, toId: to, status: "pending", createdAt: serverTimestamp()
      });
    } else {
      await createMessageRequest(to);
    }
    succeeded = true;
    $("request-chat").textContent = "Request sent";
    setRequestStatus("Request sent. Waiting for this user to accept or decline.");
  } catch (error) {
    console.error("Message request failed", error);
    setRequestStatus("Could not send request. Please try again.", true);
  } finally {
    state.requestBusy = false;
    $("message-user").disabled = false;
    $("request-chat").removeAttribute("aria-busy");
    if (!succeeded) renderRequestAction({ preserveStatus: true });
  }
});

const renderRequests = () => {
  const incoming = state.requests.filter((request) =>
    request.data().toId === state.user.uid && actorIsVisible(request.data().fromId) && request.data().status === "pending"
  );
  $("request-list").replaceChildren(...incoming.map((request) => {
    const card = document.createElement("div");
    card.className = "list-card card-row";
    const text = document.createElement("span");
    text.textContent = `@${userName(request.data().fromId)} wants to message you`;
    const actions = document.createElement("div");
    ["Accept", "Decline"].forEach((label) => {
      const button = document.createElement("button");
      button.className = label === "Accept" ? "primary" : "secondary";
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await updateDoc(request.ref, { status: label.toLowerCase(), respondedAt: serverTimestamp() });
          setStatus(label === "Accept" ? "Conversation accepted." : "Request declined.");
          setRequestStatus(label === "Accept" ? "Conversation accepted. You can message this user now." : "Request declined.");
        } catch {
          setStatus("Could not update that request.", true);
          button.disabled = false;
        }
      });
      actions.append(button);
    });
    card.append(text, actions);
    return card;
  }));
  if (!incoming.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No pending message requests.";
    $("request-list").append(empty);
  }
};

$("conversation-user").addEventListener("change", () => {
  renderDirectMessages();
  renderReveals();
});

const renderDirectMessages = () => {
  const other = $("conversation-user").value;
  const messages = state.messages.filter((message) =>
    message.data().participants.includes(state.user.uid) && message.data().participants.includes(other) && actorIsVisible(message.data().senderId) && canInteractWith(other)
  );
  $("direct-messages").replaceChildren(...messages.map((message) => {
    const data = message.data();
    const item = document.createElement("div");
    item.className = `message${data.senderId === state.user.uid ? " mine" : ""}`;
    const sender = document.createElement("small");
    sender.textContent = `@${userName(data.senderId)}`;
    const text = document.createElement("span");
    text.textContent = data.text;
    item.append(sender, text);
    return item;
  }));
  $("direct-messages").scrollTop = $("direct-messages").scrollHeight;
};

$("direct-message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const other = $("conversation-user").value;
  const text = $("direct-message").value.trim();
  if (!other || !canInteractWith(other) || !text || !safeToSend(text)) return;
  try {
    await addDoc(collection(db, "directMessages"), {
      participants: [state.user.uid, other].sort(), senderId: state.user.uid, text, createdAt: serverTimestamp()
    });
    event.target.reset();
  } catch {
    setStatus("Could not send private message.", true);
  }
});

$("send-reveal").addEventListener("click", async () => {
  const to = $("conversation-user").value;
  if (!to || !canInteractWith(to)) return;
  const fields = {
    interests: $("reveal-interests").checked,
    region: $("reveal-region").checked,
    ageRange: $("reveal-age").checked
  };
  if (!Object.values(fields).some(Boolean)) {
    setStatus("Choose at least one detail to reveal.", true);
    return;
  }
  try {
    await setDoc(doc(db, "reveals", `${state.user.uid}_${to}`), {
      fromId: state.user.uid, toId: to, fields, status: "pending", createdAt: serverTimestamp()
    });
    setStatus("Mutual reveal request sent.");
  } catch {
    setStatus("Could not send reveal request.", true);
  }
});

const renderReveals = () => {
  const other = $("conversation-user").value;
  if (!other || !canInteractWith(other)) {
    $("reveal-status").replaceChildren();
    return;
  }
  const incoming = state.reveals.find((entry) => entry.data().fromId === other && entry.data().toId === state.user.uid);
  const outgoing = state.reveals.find((entry) => entry.data().fromId === state.user.uid && entry.data().toId === other);
  const box = $("reveal-status");
  box.replaceChildren();
  if (incoming?.data().status === "pending") {
    const text = document.createElement("p");
    text.textContent = `@${userName(other)} requested a controlled reveal.`;
    const accept = document.createElement("button");
    accept.className = "primary";
    accept.textContent = "Accept selected reveal";
    accept.addEventListener("click", () => updateDoc(incoming.ref, { status: "accepted", respondedAt: serverTimestamp() }));
    box.append(text, accept);
  }
  if (incoming?.data().status === "accepted" && outgoing?.data().status === "accepted") {
    const text = document.createElement("p");
    text.textContent = "Mutual reveal accepted. Loading the selected details…";
    box.append(text);
    getDoc(doc(db, "userPrivate", other)).then((snapshot) => {
      const theirs = snapshot.data() || {};
      const fields = incoming.data().fields;
      const parts = [];
      if (fields.interests && theirs.interests) parts.push(`Interests: ${theirs.interests}`);
      if (fields.region && theirs.region) parts.push(`Region: ${theirs.region}`);
      if (fields.ageRange && theirs.ageRange) parts.push(`Age range: ${theirs.ageRange}`);
      text.textContent = parts.join(" · ") || "They accepted but have not filled in those details.";
    }).catch(() => { text.textContent = "The selected details are not available."; });
  }
};

$("privacy-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const muted = $("muted-keywords").value.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 20);
  try {
    await setDoc(doc(db, "userPreferences", state.user.uid), {
      uid: state.user.uid, mutedKeywords: muted, contextCheck: $("context-check").checked, updatedAt: serverTimestamp()
    }, { merge: true });
    await setDoc(doc(db, "userPrivate", state.user.uid), {
      uid: state.user.uid, interests: $("privacy-interests").value.trim(), region: $("privacy-region").value.trim(),
      ageRange: $("privacy-age").value, updatedAt: serverTimestamp()
    }, { merge: true });
    setStatus("Privacy choices saved.");
  } catch {
    setStatus("Could not save privacy choices.", true);
  }
});

const loadPrivacy = () => {
  const preferences = state.preferences || {};
  $("muted-keywords").value = (preferences.mutedKeywords || []).join(", ");
  $("context-check").checked = preferences.contextCheck !== false;
  $("privacy-interests").value = state.privateDetails.interests || "";
  $("privacy-region").value = state.privateDetails.region || "";
  $("privacy-age").value = state.privateDetails.ageRange || "";
};

$("download-data").addEventListener("click", () => {
  const data = {
    profile: { username: state.profile.username }, preferences: state.preferences,
    rooms: state.roomMemberships.map((membership) => membership.data()),
    messages: filterAccessibleDirectMessages(state.messages, state.blockPairs, state.blockPairsInitialized)
      .map((message) => message.data())
  };
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  anchor.download = "anonchat-my-data.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 5000);
});

const listen = (reference, key, render) => listeners.push(onSnapshot(reference, (snapshot) => {
  state[key] = snapshot.docs;
  render?.();
}, () => setStatus("A community section could not load.", true)));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    roomExpiryController.cancel();
    locallyReportedRooms.clear();
    await exitAfterAuthLoss({ redirect: () => location.replace("index.html") });
    return;
  }
  state.user = user;
  loadBlockPairs({ db, uid: user.uid, onChange: (pairs) => {
    state.blockPairs = pairs;
    state.blockPairsInitialized = true;
    renderRooms();
    renderRoomMessages();
    renderMessageUsers();
    renderRequests();
    renderDirectMessages();
    renderReveals();
  }, onError: () => setStatus("Could not load block settings.", true) }).then((unsubscribe) => listeners.push(unsubscribe)).catch(() => setStatus("Could not load block settings.", true));
  const profile = await getDoc(doc(db, "users", user.uid));
  if (!profile.exists() || profile.data().banned) {
    await exitAuthenticatedSession({
      user,
      stopListeners: () => {
        roomExpiryController.cancel();
        roomMessageUnsubscribe?.();
        listeners.forEach((unsubscribe) => unsubscribe());
      },
      redirect: () => location.replace("index.html")
    });
    return;
  }
  state.profile = profile.data();
  void recordPageActivity({
    surface: "community",
    profile: state.profile,
    user,
    db,
    firestore: { doc, updateDoc, serverTimestamp }
  });
  const privateSnapshot = await getDoc(doc(db, "userPrivate", user.uid));
  state.privateDetails = privateSnapshot.exists() ? privateSnapshot.data() : {};
  loadPrivacy();
  renderIdentity();

  listen(collection(db, "users"), "users", () => { renderMessageUsers(); renderRequests(); });
  listeners.push(onSnapshot(
    query(collection(db, "rooms"), where("moderationStatus", "==", "active")),
    (snapshot) => {
      locallyReportedRooms.reconcile(snapshot.docs.map((room) => room.id));
      state.rooms = snapshot.docs;
      renderRooms();
    },
    () => {
      locallyReportedRooms.reconcile([]);
      state.rooms = [];
      if (state.activeRoom) closeActiveRoom("This room is no longer available.");
      renderRooms();
      setStatus("Could not load active rooms.", true);
    }
  ));
  listen(query(collection(db, "roomMembers"), where("uid", "==", user.uid)), "roomMemberships", renderRooms);

  const mergePrivate = (key, firstQuery, secondQuery, render, onReady) => {
    let first = [];
    let second = [];
    let firstReady = false;
    let secondReady = false;
    const merge = () => {
      state[key] = [...first, ...second].filter((item, index, list) => list.findIndex((entry) => entry.id === item.id) === index);
      render();
      if (firstReady && secondReady) onReady?.();
    };
    listeners.push(onSnapshot(firstQuery, (snapshot) => { first = snapshot.docs; firstReady = true; merge(); }, () => setStatus("A private section could not load.", true)));
    listeners.push(onSnapshot(secondQuery, (snapshot) => { second = snapshot.docs; secondReady = true; merge(); }, () => setStatus("A private section could not load.", true)));
  };
  mergePrivate(
    "requests",
    query(collection(db, "messageRequests"), where("fromId", "==", user.uid)),
    query(collection(db, "messageRequests"), where("toId", "==", user.uid)),
    () => { renderRequests(); renderMessageUsers(); },
    () => { state.requestsLoaded = true; renderRequestAction(); }
  );
  listen(query(collection(db, "directMessages"), where("participants", "array-contains", user.uid)), "messages", renderDirectMessages);
  mergePrivate(
    "reveals",
    query(collection(db, "reveals"), where("fromId", "==", user.uid)),
    query(collection(db, "reveals"), where("toId", "==", user.uid)),
    renderReveals
  );
  listeners.push(onSnapshot(doc(db, "userPreferences", user.uid), (snapshot) => {
    state.preferences = snapshot.exists() ? snapshot.data() : { contextCheck: true, mutedKeywords: [] };
    loadPrivacy();
  }));
});
