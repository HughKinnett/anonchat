import { auth, db } from "./firebase-config.js";
import { messageRequestButtonAction, messageRequestButtonState } from "./message-request-policy.mjs";
import { recordPageActivity } from "./activity-integration.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc, collection, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const state = {
  user: null, profile: null, privateDetails: {}, users: [], rooms: [], roomMessages: [],
  roomMemberships: [], requests: [], requestsLoaded: false, requestBusy: false,
  messages: [], reveals: [], preferences: null, activeRoom: ""
};
const listeners = [];
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
    stopListeners: () => listeners.forEach((unsubscribe) => unsubscribe()),
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
  $("room-list").replaceChildren(...state.rooms.map((room) => {
    const data = room.data();
    const card = document.createElement("article");
    card.className = "list-card card-row";
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = data.name;
    const topic = document.createElement("p");
    topic.className = "muted";
    topic.textContent = data.topic;
    copy.append(heading, topic);
    const enter = document.createElement("button");
    enter.className = "primary";
    enter.textContent = joinedRoom(room.id) ? "Open room" : "Join anonymously";
    enter.addEventListener("click", () => openRoom(room.id, data.name));
    card.append(copy, enter);
    return card;
  }));
};

const openRoom = async (id, name) => {
  try {
    await setDoc(doc(db, "roomMembers", `${id}_${state.user.uid}`), {
      roomId: id, uid: state.user.uid, joinedAt: serverTimestamp()
    }, { merge: true });
  } catch {
    setStatus("Could not join that room.", true);
    return;
  }
  state.activeRoom = id;
  $("room-title").textContent = name;
  $("room-alias").textContent = `You are ${aliasFor(id)}`;
  renderRoomMessages();
  $("room-dialog").showModal();
};

$("room-dialog").querySelector(".dialog-close").addEventListener("click", () => {
  $("room-dialog").close();
  state.activeRoom = "";
});

const renderRoomMessages = () => {
  const messages = state.roomMessages.filter((message) =>
    message.data().roomId === state.activeRoom && message.data().expiresAt?.toMillis?.() > now()
  );
  $("room-messages").replaceChildren(...messages.map((message) => {
    const data = message.data();
    const item = document.createElement("div");
    item.className = `message${data.senderId === state.user.uid ? " mine" : ""}`;
    const sender = document.createElement("small");
    sender.textContent = data.tempName;
    const text = document.createElement("span");
    text.textContent = data.text;
    item.append(sender, text);
    return item;
  }));
  $("room-messages").scrollTop = $("room-messages").scrollHeight;
};

$("room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const made = await addDoc(collection(db, "rooms"), {
      name: $("room-name").value.trim(), topic: $("room-topic").value.trim(),
      ownerId: state.user.uid, createdAt: serverTimestamp()
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
  if (!text || !safeToSend(text)) return;
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

const requestFor = (other) => state.requests.find((request) =>
  [request.data().fromId, request.data().toId].includes(state.user.uid) &&
  [request.data().fromId, request.data().toId].includes(other)
);
const acceptedUsers = () => state.users.filter((user) =>
  user.id !== state.user.uid && requestFor(user.id)?.data().status === "accepted"
);

const createMessageRequest = (to) => {
  const id = [state.user.uid, to].sort().join("_");
  return setDoc(doc(db, "messageRequests", id), {
    fromId: state.user.uid, toId: to, status: "pending", createdAt: serverTimestamp()
  });
};

const renderMessageUsers = () => {
  const selectedUser = $("message-user").value;
  const others = state.users.filter((user) => user.id !== state.user.uid);
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
    request.data().toId === state.user.uid && request.data().status === "pending"
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
    message.data().participants.includes(state.user.uid) && message.data().participants.includes(other)
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
  if (!other || !text || !safeToSend(text)) return;
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
  if (!to) return;
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
    messages: state.messages.map((message) => message.data())
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
    await exitAfterAuthLoss({ redirect: () => location.replace("index.html") });
    return;
  }
  state.user = user;
  const profile = await getDoc(doc(db, "users", user.uid));
  if (!profile.exists() || profile.data().banned) {
    await exitAuthenticatedSession({
      user,
      stopListeners: () => listeners.forEach((unsubscribe) => unsubscribe()),
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
  listen(query(collection(db, "rooms"), orderBy("createdAt", "desc")), "rooms", renderRooms);
  listen(query(collection(db, "roomMessages"), orderBy("createdAt", "asc")), "roomMessages", renderRoomMessages);
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
