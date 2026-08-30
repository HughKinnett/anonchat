import { auth, db } from "./firebase-config.js";
import { messageRequestButtonAction, messageRequestButtonState } from "./message-request-policy.mjs";
import { createModerationClient } from "./moderation-client.mjs";
import { REPORT_BUTTON_CLASS, isRoomActive, roomExpiry } from "./moderation-policy.mjs";
import { compareNewestFirst, compareOldestFirst } from "./content-ordering.mjs";
import { formatDisappearsAt, scheduleExpiryBoundary } from "./temporary-room-timer-policy.mjs";
import { recordPageActivity } from "./activity-integration.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { createViewerBlockTracker, isBlockedActor } from "./viewer-block-policy.mjs";
import { createSessionGeneration } from "./session-generation-policy.mjs";
import { applyPrivacyWatermark, clearPrivacyWatermark } from "./privacy-watermark.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc, collection, deleteDoc, deleteField, doc, documentId, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const state = {
  user: null, profile: null, privateDetails: {}, users: [], rooms: [], roomMessages: [],
  roomMemberships: [], requests: [], requestsLoaded: false, requestBusy: false,
  messages: [], reveals: [], preferences: null, activeRoom: "",
  blockTracker: createViewerBlockTracker(), viewerBlocks: null, moderation: null
};
state.viewerBlocks = state.blockTracker.current();
const listeners = [];
const sessionGeneration = createSessionGeneration();
let activeCommunitySession = 0;
let clearRoomExpiryTimer = () => {};
let clearDirectMessageExpiryTimer = () => {};
let stopRoomMessageListener = () => {};
let pendingRoomImage = "";
let pendingDirectImage = "";
const revealedPrivatePhotos = new Map();
const directMessageListeners = new Map();
const directMessageBuckets = new Map();
const stopDirectMessageListeners = () => {
  directMessageListeners.forEach((unsubscribe) => unsubscribe());
  directMessageListeners.clear();
  directMessageBuckets.clear();
};
const setStatus = (text, error = false) => {
  $("status").textContent = text;
  $("status").classList.toggle("danger", error);
};
const setRequestStatus = (text, error = false) => {
  $("request-status").textContent = text;
  $("request-status").classList.toggle("danger", error);
};
const userName = (uid) => !isBlockedUid(uid)
  ? state.users.find((entry) => entry.id === uid)?.data().username || "anonymous"
  : "anonymous";
const now = () => Date.now();
const isBlockedUid = (uid) => isBlockedActor(uid, state.viewerBlocks);
const activeRoom = (roomId = state.activeRoom) => state.rooms.find((room) => room.id === roomId);
const roomIsAvailable = (room) => room && isRoomActive(room.data(), now()) && !isBlockedUid(room.data().ownerId);
const closeActiveRoom = (message) => {
  stopRoomMessageListener();
  stopRoomMessageListener = () => {};
  state.roomMessages = [];
  state.activeRoom = "";
  clearRoomExpiryTimer();
  clearRoomExpiryTimer = () => {};
  if ($("room-dialog").open) $("room-dialog").close();
  if (message) setStatus(message, true);
};
const listenToRoomMessages = (roomId) => {
  stopRoomMessageListener();
  stopRoomMessageListener = onSnapshot(query(
    collection(db, "roomMessages"),
    where("roomId", "==", roomId),
    where("moderationState", "==", "visible"),
    orderBy("createdAt", "asc"),
    orderBy(documentId()),
    limit(100)
  ), (snapshot) => {
    if (state.activeRoom !== roomId) return;
    state.roomMessages = snapshot.docs;
    renderRoomMessages();
  }, () => {
    if (state.activeRoom === roomId) closeActiveRoom("That room is no longer available.");
  });
};
const scheduleActiveRoomExpiry = () => {
  clearRoomExpiryTimer();
  const room = activeRoom();
  clearRoomExpiryTimer = scheduleExpiryBoundary({
    expiries: [room?.data().expiresAt], nowMillis: now(),
    onBoundary: () => { renderRooms(); renderRoomMessages(); }
  });
};
const aggressive = /\b(fuck|bitch|kill|hate|stupid|idiot|dumb|worthless|shut up)\b/i;
const safeToSend = (text) => !state.preferences?.contextCheck || !aggressive.test(text) ||
  window.confirm("This may come across as aggressive. Do you want to send it as written?");
const consumeViewedPhoto = (message) => {
  const data = message.data();
  if (!data.imageData || data.senderId === state.user?.uid) return;
  updateDoc(message.ref, {
    imageData: deleteField(),
    photoViewedBy: state.user.uid,
    photoViewedAt: serverTimestamp()
  }).catch(() => setStatus("That view-once photo has already disappeared."));
};


const attachMentionAutocomplete = (input) => {
  const host = input?.parentElement;
  if (!input || !host) return;
  host.classList.add("mention-input-host");
  const suggestions = document.createElement("div");
  suggestions.className = "mention-suggestions";
  suggestions.hidden = true;
  host.append(suggestions);

  const close = () => {
    suggestions.hidden = true;
    suggestions.replaceChildren();
  };
  const choose = (username) => {
    const cursor = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, cursor);
    const match = before.match(/@([A-Za-z0-9_]*)$/);
    if (!match) return;
    const after = input.value.slice(cursor);
    input.value = `${before.slice(0, -match[0].length)}@${username} ${after}`;
    const nextCursor = before.length - match[0].length + username.length + 2;
    input.setSelectionRange(nextCursor, nextCursor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    close();
    input.focus();
  };
  const render = () => {
    const cursor = input.selectionStart ?? input.value.length;
    const match = input.value.slice(0, cursor).match(/@([A-Za-z0-9_]*)$/);
    if (!match) return close();
    const queryText = match[1].toLowerCase();
    const matches = state.users
      .filter((entry) => !isBlockedUid(entry.id)
        && entry.data().username?.toLowerCase().startsWith(queryText))
      .slice(0, 6);
    if (!matches.length) return close();
    suggestions.replaceChildren(...matches.map((entry) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "mention-suggestion";
      option.textContent = `@${entry.data().username}`;
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        choose(entry.data().username);
      });
      return option;
    }));
    suggestions.hidden = false;
  };
  input.addEventListener("input", render);
  input.addEventListener("click", render);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
    if (event.key === "Enter" && !suggestions.hidden) {
      event.preventDefault();
      suggestions.querySelector("button")?.dispatchEvent(new PointerEvent("pointerdown"));
    }
  });
  input.addEventListener("blur", () => window.setTimeout(close, 120));
};

attachMentionAutocomplete($("room-message"));
attachMentionAutocomplete($("direct-message"));

const compressMessageImage = (file) => new Promise((resolve, reject) => {
  if (!file?.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    reject(new Error("Choose an image smaller than 10 MB."));
    return;
  }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error("Could not read that image."));
  reader.onload = () => {
    const image = new Image();
    image.onerror = () => reject(new Error("Could not open that image."));
    image.onload = () => {
      const scale = Math.min(1, 1400 / image.width, 1400 / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.7);
      if (data.length > 780000) reject(new Error("That image is still too large after compression."));
      else resolve(data);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

const bindMessagePhoto = ({ inputId, labelFor, previewId, wrapId, removeId, setPending }) => {
  const input = $(inputId);
  const label = document.querySelector(`label[for='${labelFor}']`);
  const preview = $(previewId);
  const wrap = $(wrapId);
  const clear = () => {
    setPending("");
    input.value = "";
    preview.removeAttribute("src");
    wrap.hidden = true;
    label.classList.remove("is-selected");
    label.setAttribute("aria-pressed", "false");
  };
  label.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    input.click();
  });
  input.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setStatus("Preparing your message photo…");
    try {
      const data = await compressMessageImage(file);
      setPending(data);
      preview.src = data;
      wrap.hidden = false;
      label.classList.add("is-selected");
      label.setAttribute("aria-pressed", "true");
      setStatus("Photo ready.");
    } catch (error) {
      clear();
      setStatus(error.message || "Could not prepare that photo.", true);
    }
  });
  $(removeId).addEventListener("click", clear);
  return clear;
};

const clearRoomPhoto = bindMessagePhoto({
  inputId: "room-photo-upload", labelFor: "room-photo-upload", previewId: "room-photo-preview",
  wrapId: "room-photo-preview-wrap", removeId: "remove-room-photo", setPending: (value) => { pendingRoomImage = value; }
});
const clearDirectPhoto = bindMessagePhoto({
  inputId: "direct-photo-upload", labelFor: "direct-photo-upload", previewId: "direct-photo-preview",
  wrapId: "direct-photo-preview-wrap", removeId: "remove-direct-photo", setPending: (value) => { pendingDirectImage = value; }
});

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
    stopListeners: invalidateCommunitySession,
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
const renderRooms = () => {
  if (!state.viewerBlocks.ready) {
    $("room-list").replaceChildren();
    return;
  }
  const rooms = state.rooms.filter((room) => roomIsAvailable(room)).sort(compareNewestFirst);
  if (state.activeRoom && !rooms.some((room) => room.id === state.activeRoom)) {
    closeActiveRoom("That room is no longer available.");
  }
  $("room-list").replaceChildren(...rooms.map((room) => {
    const data = room.data();
    const card = document.createElement("article");
    card.className = "list-card card-row";
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = data.name;
    const topic = document.createElement("p");
    topic.className = "muted";
    topic.textContent = data.topic;
    const expiry = document.createElement("small");
    expiry.className = "muted";
    expiry.textContent = formatDisappearsAt(data.expiresAt);
    copy.append(heading, topic, expiry);
    const enter = document.createElement("button");
    enter.className = "primary";
    enter.textContent = joinedRoom(room.id) ? "Open room" : "Join anonymously";
    enter.addEventListener("click", () => openRoom(room.id, data.name));
    const controls = document.createElement("div");
    controls.className = "room-card-actions";
    controls.append(enter);
    if (data.ownerId === state.user.uid) {
      const removeRoom = document.createElement("button");
      removeRoom.type = "button";
      removeRoom.className = "primary";
      removeRoom.textContent = "Delete room";
      removeRoom.setAttribute("aria-label", `Delete temporary room ${data.name}`);
      removeRoom.addEventListener("click", async () => {
        if (!window.confirm("Delete this temporary room now? Everyone will immediately lose access.")) return;
        removeRoom.disabled = true;
        try {
          await updateDoc(room.ref, {
            cleanupState: "closing",
            closedAt: serverTimestamp(),
            expiresAt: serverTimestamp()
          });
          state.rooms = state.rooms.filter((entry) => entry.id !== room.id);
          if (state.activeRoom === room.id) closeActiveRoom("You deleted this temporary room.");
          renderRooms();
          setStatus("Temporary room deleted.");
        } catch {
          removeRoom.disabled = false;
          setStatus("Could not delete that temporary room.", true);
        }
      });
      controls.append(removeRoom);
    } else {
      controls.append(reportRoomControl(room));
    }
    card.append(copy, controls);
    return card;
  }));
};

const openRoom = async (id, name) => {
  try {
    const currentRoom = await getDoc(doc(db, "rooms", id));
    if (!currentRoom.exists() || !isRoomActive(currentRoom.data(), now())) throw new Error("room-unavailable");
    if (isBlockedUid(currentRoom.data().ownerId)) throw new Error("room-blocked");
    state.rooms = state.rooms.map((room) => room.id === id ? currentRoom : room);
    await setDoc(doc(db, "roomMembers", `${id}_${state.user.uid}`), {
      roomId: id, uid: state.user.uid, joinedAt: serverTimestamp()
    }, { merge: true });
  } catch {
    setStatus("Could not join that room.", true);
    return;
  }
  state.activeRoom = id;
  state.roomMessages = [];
  listenToRoomMessages(id);
  $("room-title").textContent = name;
  $("room-alias").textContent = `You are ${aliasFor(id)}`;
  renderRoomMessages();
  scheduleActiveRoomExpiry();
  $("room-dialog").showModal();
};

$("room-dialog").querySelector(".dialog-close").addEventListener("click", () => {
  closeActiveRoom();
});

const renderRoomMessages = () => {
  const room = activeRoom();
  $("room-disappears").textContent = room
    ? formatDisappearsAt(room.data().expiresAt)
    : "Disappearance time unavailable";
  if (!state.viewerBlocks.ready) {
    $("room-message-form").hidden = true;
    $("room-messages").replaceChildren();
    return;
  }
  const expired = !room || !isRoomActive(room.data(), now());
  const form = $("room-message-form");
  form.hidden = expired;
  if (expired && state.activeRoom) {
    $("room-title").textContent = "Room expired";
    $("room-alias").textContent = "This temporary room is no longer active.";
  }
  const messages = state.roomMessages.filter((message) =>
    message.data().roomId === state.activeRoom
    && message.data().expiresAt?.toMillis?.() > now()
    && !isBlockedUid(message.data().senderId)
  ).sort(compareOldestFirst);
  $("room-messages").replaceChildren(...messages.map((message) => {
    const data = message.data();
    const item = document.createElement("div");
    item.className = `message${data.senderId === state.user.uid ? " mine" : ""}`;
    const sender = document.createElement("small");
    sender.textContent = data.tempName;
    const text = document.createElement("span");
    text.textContent = data.text;
    item.append(sender);
    if (data.text) item.append(text);
    if (data.imageData) {
      const photo = document.createElement("img");
      photo.className = "message-photo";
      photo.src = data.imageData;
      photo.alt = "Photo sent in this temporary room";
      item.append(photo);
    }
    return item;
  }));
  $("room-messages").scrollTop = $("room-messages").scrollHeight;
  scheduleActiveRoomExpiry();
};

const reportRoomControl = (room) => {
  const controls = document.createElement("div");
  controls.className = "message-report";
  const reason = document.createElement("select");
  reason.setAttribute("aria-label", "Report reason");
  ["harassment", "hate-threats", "sexual-content", "spam-scam", "privacy-impersonation", "other"].forEach((value) =>
    reason.append(new Option(value.replaceAll("-", " "), value))
  );
  const button = document.createElement("button");
  button.type = "button";
  button.className = REPORT_BUTTON_CLASS;
  button.textContent = "Report";
  button.setAttribute("aria-label", `Report temporary room ${room.data().name}`);
  const status = document.createElement("span");
  status.role = "status";
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Reporting…";
    const target = {
      targetKind: "room", targetCollection: "rooms", targetId: room.id,
      targetPath: `rooms/${room.id}`, reportedUserId: room.data().ownerId
    };
    try {
      if (await state.moderation.hasReported(target)) throw Object.assign(new Error("already reported"), { code: "already-reported" });
      await state.moderation.report(target, reason.value);
      state.rooms = state.rooms.filter((entry) => entry.id !== room.id);
      if (state.activeRoom === room.id) closeActiveRoom("That room is paused for administrator review.");
      renderRooms();
      status.textContent = "Reported. The room is paused for administrator review.";
      reason.disabled = true;
      button.textContent = "Reported";
    } catch (error) {
      const duplicate = error?.code === "already-reported";
      status.textContent = duplicate ? "Already reported." : "Could not report. Try again.";
      button.disabled = duplicate;
    }
  });
  controls.append(reason, button, status);
  return controls;
};

$("room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const made = await addDoc(collection(db, "rooms"), {
      name: $("room-name").value.trim(), topic: $("room-topic").value.trim(),
      ownerId: state.user.uid, expiresAt: Timestamp.fromMillis(roomExpiry(now())),
      moderationState: "visible", createdAt: serverTimestamp()
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
  if ((!text && !pendingRoomImage) || (text && !safeToSend(text))) return;
  const room = activeRoom();
  if (!room || !isRoomActive(room.data(), now())) {
    setStatus("Room expired.", true);
    renderRoomMessages();
    return;
  }
  if (isBlockedUid(room.data().ownerId)) {
    setStatus("Could not send to a blocked room.", true);
    return;
  }
  try {
    await addDoc(collection(db, "roomMessages"), {
      roomId: state.activeRoom, senderId: state.user.uid, tempName: aliasFor(state.activeRoom), text,
      ...(pendingRoomImage ? { imageData: pendingRoomImage } : {}),
      expiresAt: room.data().expiresAt, moderationState: "visible", createdAt: serverTimestamp()
    });
    event.target.reset();
    clearRoomPhoto();
  } catch {
    setStatus("Could not send room message.", true);
  }
});

const requestFor = (other) => {
  if (isBlockedUid(other)) return undefined;
  const pair = state.requests.filter((request) =>
    [request.data().fromId, request.data().toId].includes(state.user.uid)
    && [request.data().fromId, request.data().toId].includes(other)
  );
  return pair.find((request) => request.data().status === "accepted") || pair[0];
};
const acceptedUsers = () => state.users.filter((user) =>
  user.id !== state.user.uid && !isBlockedUid(user.id) && requestFor(user.id)?.data().status === "accepted"
);

const createMessageRequest = (to) => {
  const id = [state.user.uid, to].sort().join("_");
  return setDoc(doc(db, "messageRequests", id), {
    fromId: state.user.uid, toId: to, status: "pending", createdAt: serverTimestamp()
  });
};

const renderMessageUsers = () => {
  if (!state.viewerBlocks.ready) {
    $("message-user").replaceChildren();
    $("conversation-user").replaceChildren();
    $("direct-message-form").hidden = true;
    renderRequestAction();
    renderDirectMessages();
    renderReveals();
    return;
  }
  const selectedUser = $("message-user").value;
  const selectedConversation = $("conversation-user").value;
  const others = state.users.filter((user) =>
    user.id !== state.user.uid && !isBlockedUid(user.id)
    && requestFor(user.id)?.data().status !== "accepted"
  );
  const accepted = acceptedUsers();
  $("message-user").replaceChildren(...others.map((user) => new Option(`@${user.data().username}`, user.id)));
  if (others.some((user) => user.id === selectedUser)) $("message-user").value = selectedUser;
  $("conversation-user").replaceChildren(...accepted.map((user) => new Option(`@${user.data().username}`, user.id)));
  if (accepted.some((user) => user.id === selectedConversation)) $("conversation-user").value = selectedConversation;
  if (selectedConversation && isBlockedUid(selectedConversation)) setStatus("This conversation is unavailable because of a block.");
  $("direct-message-form").hidden = !accepted.length;
  renderRequestAction();
  renderDirectMessages();
  renderReveals();
};

const renderRequestAction = ({ preserveStatus = false } = {}) => {
  const to = $("message-user").value;
  if (!state.viewerBlocks.ready || !state.requestsLoaded) {
    $("request-chat").textContent = "Loading requests…";
    $("request-chat").disabled = true;
    $("request-chat").setAttribute("aria-busy", "true");
    setRequestStatus("Checking existing requests…");
    return;
  }
  if (state.requestBusy) return;
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
  if (!to) {
    setRequestStatus("Choose a user to request a conversation.", true);
    return;
  }
  if (isBlockedUid(to)) {
    setRequestStatus("This conversation is unavailable because of a block.", true);
    renderMessageUsers();
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
  if (!state.viewerBlocks.ready) {
    $("request-list").replaceChildren();
    return;
  }
  const incoming = state.requests.filter((request) =>
    request.data().toId === state.user.uid && request.data().status === "pending"
    && !isBlockedUid(request.data().fromId)
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
  revealedPrivatePhotos.clear();
  renderDirectMessages();
  renderReveals();
});

const renderDirectMessages = () => {
  clearDirectMessageExpiryTimer();
  clearDirectMessageExpiryTimer = () => {};
  if (!state.viewerBlocks.ready) {
    $("direct-messages").replaceChildren();
    return;
  }
  const other = $("conversation-user").value;
  const currentTime = now();
  const messages = state.messages.filter((message) =>
    message.data().participants.includes(state.user.uid) && message.data().participants.includes(other)
    && !isBlockedUid(message.data().senderId)
    && (!message.data().expiresAt?.toMillis || message.data().expiresAt.toMillis() > currentTime)
  ).sort(compareOldestFirst);
  $("direct-messages").replaceChildren(...messages.map((message) => {
    const data = message.data();
    const item = document.createElement("div");
    item.className = `message${data.senderId === state.user.uid ? " mine" : ""}`;
    const sender = document.createElement("small");
    sender.textContent = `@${userName(data.senderId)}`;
    const text = document.createElement("span");
    text.textContent = data.text;
    const actions = document.createElement("span");
    actions.className = "private-message-actions";
    if (data.expiresAt?.toDate) {
      const expiry = document.createElement("small");
      expiry.textContent = `Disappears ${data.expiresAt.toDate().toLocaleString()}`;
      actions.append(expiry);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "private-message-delete";
    remove.textContent = "Delete for everyone";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        const legacyReference = doc(db, "directMessages", message.id);
        const legacySnapshot = await getDoc(legacyReference);
        const batch = writeBatch(db);
        batch.delete(message.ref);
        if (legacySnapshot.exists()) batch.delete(legacyReference);
        await batch.commit();
        revealedPrivatePhotos.delete(message.id);
        setStatus("Private message deleted permanently.");
      } catch {
        remove.disabled = false;
        setStatus("Could not delete that private message.", true);
      }
    });
    actions.append(remove);
    item.append(sender);
    if (data.text) item.append(text);
    const revealedImage = revealedPrivatePhotos.get(message.id);
    const imageData = data.senderId === state.user.uid ? data.imageData : revealedImage;
    if (imageData) {
      const photo = document.createElement("img");
      photo.className = "message-photo";
      photo.src = imageData;
      photo.alt = "Photo sent in this private conversation";
      item.append(photo);
    } else if (data.imageData && data.senderId !== state.user.uid) {
      const viewPhoto = document.createElement("button");
      viewPhoto.type = "button";
      viewPhoto.className = "view-once-photo-button";
      viewPhoto.textContent = "View photo once";
      viewPhoto.addEventListener("click", () => {
        revealedPrivatePhotos.set(message.id, data.imageData);
        renderDirectMessages();
        void consumeViewedPhoto(message);
      }, { once: true });
      item.append(viewPhoto);
    } else if (data.photoViewedAt) {
      const viewed = document.createElement("small");
      viewed.className = "view-once-photo-status";
      viewed.textContent = "View-once photo opened";
      item.append(viewed);
    }
    item.append(actions);
    return item;
  }));
  $("direct-messages").scrollTop = $("direct-messages").scrollHeight;
  const nextExpiry = messages.map((message) => message.data().expiresAt?.toMillis?.())
    .filter((value) => Number.isFinite(value) && value > currentTime)
    .sort((left, right) => left - right)[0];
  if (nextExpiry) {
    const timer = window.setTimeout(renderDirectMessages, Math.min(nextExpiry - currentTime + 50, 2147483647));
    clearDirectMessageExpiryTimer = () => window.clearTimeout(timer);
  }
};

$("delete-chat").addEventListener("click", async () => {
  const other = $("conversation-user").value;
  if (!other) {
    setStatus("Choose an accepted conversation first.", true);
    return;
  }
  const chatMessages = state.messages.filter((message) =>
    message.data().participants.includes(state.user.uid)
    && message.data().participants.includes(other)
  );
  if (!window.confirm("Delete this entire private conversation for both users? This cannot be undone.")) return;
  const control = $("delete-chat");
  control.disabled = true;
  control.textContent = "Deleting chat…";
  try {
    const legacySnapshot = await getDocs(query(
      collection(db, "directMessages"),
      where("participants", "array-contains", state.user.uid)
    ));
    const legacyMessages = legacySnapshot.docs.filter((message) =>
      message.data().participants?.includes(other)
    );
    const references = [...chatMessages.map((message) => message.ref), ...legacyMessages.map((message) => message.ref)]
      .filter((reference, index, list) => list.findIndex((item) => item.path === reference.path) === index);
    for (let offset = 0; offset < references.length; offset += 400) {
      const batch = writeBatch(db);
      references.slice(offset, offset + 400).forEach((reference) => batch.delete(reference));
      await batch.commit();
    }
    const acceptedRequest = requestFor(other);
    if (acceptedRequest) await deleteDoc(acceptedRequest.ref);
    setStatus("Private conversation deleted permanently.");
  } catch {
    setStatus("Could not delete the entire chat.", true);
  } finally {
    control.disabled = false;
    control.textContent = "Delete chat";
  }
});

$("direct-message-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const other = $("conversation-user").value;
  const text = $("direct-message").value.trim();
  if (!other || (!text && !pendingDirectImage) || (text && !safeToSend(text))) return;
  if (isBlockedUid(other)) {
    setStatus("Could not send to a blocked user.", true);
    return;
  }
  try {
    const disappear = $("direct-message-disappear").checked;
    const acceptedRequest = requestFor(other);
    if (!acceptedRequest || acceptedRequest.data().status !== "accepted") {
      setStatus("This conversation request is no longer accepted.", true);
      return;
    }
    await addDoc(collection(db, "messageRequests", acceptedRequest.id, "messages"), {
      participants: [state.user.uid, other].sort(),
      senderId: state.user.uid,
      text,
      ...(pendingDirectImage ? { imageData: pendingDirectImage } : {}),
      createdAt: serverTimestamp(),
      ...(disappear ? { expiresAt: Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000) } : {})
    });
    event.target.reset();
    clearDirectPhoto();
  } catch {
    setStatus("Could not send private message.", true);
  }
});

$("send-reveal").addEventListener("click", async () => {
  const to = $("conversation-user").value;
  if (!to || isBlockedUid(to)) return;
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
  if (!state.viewerBlocks.ready || !other || isBlockedUid(other)) {
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

const refreshViewerBlocks = () => {
  state.viewerBlocks = state.blockTracker.current();
  if (state.activeRoom && !roomIsAvailable(activeRoom())) {
    state.activeRoom = "";
    if ($("room-dialog").open) $("room-dialog").close();
  }
  renderRooms();
  renderRoomMessages();
  renderMessageUsers();
  renderRequests();
  renderReveals();
};

$("download-data").addEventListener("click", () => {
  const data = {
    profile: { username: state.profile.username }, preferences: state.preferences,
    rooms: state.roomMemberships.map((membership) => membership.data()),
    messages: state.messages.filter((message) =>
      !isBlockedUid(message.data().participants.find((uid) => uid !== state.user.uid))
    ).map((message) => message.data())
  };
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  anchor.download = "anonchat-my-data.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 5000);
});

const stopCommunityResources = () => {
  clearPrivacyWatermark();
  revealedPrivatePhotos.clear();
  listeners.splice(0).forEach((unsubscribe) => unsubscribe());
  clearRoomExpiryTimer();
  clearRoomExpiryTimer = () => {};
  stopRoomMessageListener();
  stopRoomMessageListener = () => {};
  stopDirectMessageListeners();
  state.moderation?.destroy();
  Object.assign(state, {
    profile: null, privateDetails: {}, users: [], rooms: [], roomMessages: [],
    roomMemberships: [], requests: [], requestsLoaded: false, requestBusy: false,
    messages: [], reveals: [], preferences: null, activeRoom: "", moderation: null
  });
  state.blockTracker.reset(state.user?.uid);
  state.viewerBlocks = state.blockTracker.current();
  if ($("room-dialog").open) $("room-dialog").close();
  $("identity-card").replaceChildren();
  loadPrivacy();
  renderRooms();
  renderRoomMessages();
  renderMessageUsers();
  renderRequests();
  renderReveals();
};

const invalidateCommunitySession = () => {
  sessionGeneration.invalidate();
  stopCommunityResources();
};

onAuthStateChanged(auth, async (user) => {
  activeCommunitySession = sessionGeneration.begin(user?.uid);
  const session = activeCommunitySession;
  const sessionIsCurrent = () => sessionGeneration.isCurrent(session, user?.uid);
  stopCommunityResources();
  if (!user) {
    state.user = null;
    stopCommunityResources();
    await exitAfterAuthLoss({ redirect: () => location.replace("index.html") });
    return;
  }
  state.user = user;
  state.blockTracker = createViewerBlockTracker(user.uid);
  state.viewerBlocks = state.blockTracker.current();
  const listenForSession = (reference, next, failed) => listeners.push(onSnapshot(
    reference,
    (snapshot) => { if (sessionIsCurrent()) next(snapshot); },
    (error) => { if (sessionIsCurrent()) failed?.(error); }
  ));
  const listen = (reference, key, render) => listenForSession(reference, (snapshot) => {
    state[key] = snapshot.docs;
    render?.();
  }, () => setStatus("A community section could not load.", true));
  const syncDirectMessageListeners = () => {
    const acceptedRequests = new Map();
    state.requests.forEach((request) => {
      const data = request.data();
      if (data.status !== "accepted") return;
      const otherId = data.fromId === user.uid
        ? data.toId
        : data.toId === user.uid
          ? data.fromId
          : "";
      if (otherId && !isBlockedUid(otherId)) acceptedRequests.set(otherId, request.id);
    });

    directMessageListeners.forEach((unsubscribe, otherId) => {
      if (acceptedRequests.has(otherId)) return;
      unsubscribe();
      directMessageListeners.delete(otherId);
      directMessageBuckets.delete(otherId);
    });

    acceptedRequests.forEach((requestId, otherId) => {
      if (directMessageListeners.has(otherId)) return;
      const unsubscribe = onSnapshot(
        query(collection(db, "messageRequests", requestId, "messages"), orderBy("createdAt", "asc")),
        (snapshot) => {
          if (!sessionIsCurrent()) return;
          directMessageBuckets.set(otherId, snapshot.docs);
          state.messages = [...directMessageBuckets.values()].flat();
          renderDirectMessages();
        },
        () => {
          if (!sessionIsCurrent()) return;
          directMessageBuckets.delete(otherId);
          state.messages = [...directMessageBuckets.values()].flat();
          renderDirectMessages();
          setStatus("Could not load one of your private conversations.", true);
        }
      );
      directMessageListeners.set(otherId, unsubscribe);
    });

    state.messages = [...directMessageBuckets.values()].flat();
    renderDirectMessages();
  };
  const profile = await getDoc(doc(db, "users", user.uid));
  if (!sessionIsCurrent()) return;
  if (!profile.exists() || profile.data().banned) {
    await exitAuthenticatedSession({
      user,
      stopListeners: invalidateCommunitySession,
      redirect: () => location.replace("index.html")
    });
    return;
  }
  state.profile = profile.data();
  applyPrivacyWatermark({ username: state.profile.username, surface: "private community" });
  void recordPageActivity({
    surface: "community",
    profile: state.profile,
    user,
    db,
    firestore: { doc, updateDoc, serverTimestamp }
  });
  const privateSnapshot = await getDoc(doc(db, "userPrivate", user.uid));
  if (!sessionIsCurrent()) return;
  state.privateDetails = privateSnapshot.exists() ? privateSnapshot.data() : {};
  loadPrivacy();
  renderIdentity();

  listen(query(collection(db, "users"), limit(500)), "users", () => { renderMessageUsers(); renderRequests(); });
  state.moderation = createModerationClient({
    db, currentUid: user.uid, timestamp: serverTimestamp,
    firestore: { deleteDoc, doc, getDoc, setDoc, writeBatch }
  });
  listenForSession(
    query(collection(db, "blocks"), where("blockerUid", "==", user.uid)),
    (snapshot) => {
      state.viewerBlocks = state.blockTracker.update("outgoing", snapshot.docs);
      refreshViewerBlocks();
    },
    () => {
      state.viewerBlocks = state.blockTracker.fail("outgoing");
      refreshViewerBlocks();
      setStatus("Could not load block preferences.", true);
    }
  );
  listenForSession(
    query(collection(db, "blocks"), where("blockedUid", "==", user.uid)),
    (snapshot) => {
      state.viewerBlocks = state.blockTracker.update("incoming", snapshot.docs);
      refreshViewerBlocks();
    },
    () => {
      state.viewerBlocks = state.blockTracker.fail("incoming");
      refreshViewerBlocks();
      setStatus("Could not load block preferences.", true);
    }
  );
  listen(query(collection(db, "rooms"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), orderBy(documentId()), limit(100)), "rooms", renderRooms);
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
    listenForSession(firstQuery, (snapshot) => { first = snapshot.docs; firstReady = true; merge(); }, () => setStatus("A private section could not load.", true));
    listenForSession(secondQuery, (snapshot) => { second = snapshot.docs; secondReady = true; merge(); }, () => setStatus("A private section could not load.", true));
  };
  mergePrivate(
    "requests",
    query(collection(db, "messageRequests"), where("fromId", "==", user.uid), limit(500)),
    query(collection(db, "messageRequests"), where("toId", "==", user.uid), limit(500)),
    () => { renderRequests(); renderMessageUsers(); syncDirectMessageListeners(); },
    () => { state.requestsLoaded = true; renderRequestAction(); syncDirectMessageListeners(); }
  );
  mergePrivate(
    "reveals",
    query(collection(db, "reveals"), where("fromId", "==", user.uid)),
    query(collection(db, "reveals"), where("toId", "==", user.uid)),
    renderReveals
  );
  listenForSession(doc(db, "userPreferences", user.uid), (snapshot) => {
    state.preferences = snapshot.exists() ? snapshot.data() : { contextCheck: true, mutedKeywords: [] };
    loadPrivacy();
  });
});

addEventListener("pagehide", (event) => {
  clearRoomExpiryTimer();
  if (!event.persisted) {
    sessionGeneration.invalidate();
    stopCommunityResources();
  }
});
addEventListener("pageshow", (event) => { if (event.persisted) scheduleActiveRoomExpiry(); });
