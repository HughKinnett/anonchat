import { auth, db } from "./firebase-config.js";
import { ensureUserProfile } from "./legacy-profile.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { VAPID_PUBLIC_KEY } from "./push-config.mjs";
import { createPushAlertsClient } from "./push-client.mjs";
import { applyPushAlertState } from "./push-alert-ui.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { markNotificationsSeen, readSeenNotificationIds } from "./notification-storage.mjs";
import { buildInAppNotifications, notificationUiId } from "./notification-ui-policy.mjs";
import { createRoomMessageListenerRegistry } from "./room-report-ui-policy.mjs";
import {
  canShowActorContent,
  communityPostReportPayloads,
  postIsVisible,
  postReportPayloads,
  reportId
} from "./moderation-policy.mjs";
import {
  createReportSubmissionGate,
  postDocumentKey,
  postExpirySelection,
  postExpiryTimestamp,
  postImagePresentation,
  postInteractionTarget,
  postReportTarget
} from "./post-report-ui-policy.mjs";
import { voteBelongsToTarget, voteDocumentPlan } from "./vote-schema-policy.mjs";
import { isBlockedPair, loadBlockPairs } from "./block-integration.mjs";
import { onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const feed = document.getElementById("feed");
const form = document.getElementById("post-form");
const content = document.getElementById("post-content");
const status = document.getElementById("timeline-status");
const allPostsButton = document.getElementById("show-all-posts");
const profilePostsButton = document.getElementById("show-profile-posts");
let currentUser;
let profileUsername;
let postDocs = [];
let reactions = [];
let comments = [];
let follows = [];
let users = [];
let notificationReads = [];
let communityPostDocs = [];
let pollVotes = [];
let messageRequests = [];
let roomMessages = [];
let roomMemberships = [];
let rooms = [];
let reveals = [];
let blockPairs = new Set();
let blockPairsInitialized = false;
let showingProfile = false;
const listeners = [];
const notificationButton = document.getElementById("notification-button");
const notificationPanel = document.getElementById("notification-panel");
const notificationList = document.getElementById("notification-list");
const notificationBadge = document.getElementById("notification-badge");
const searchInput = document.getElementById("site-search");
const searchResults = document.getElementById("search-results");
let currentNotificationIds = [];
let seenNotificationIds = new Set();
let pendingPostImage = "";
const locallyReportedPostIds = new Set();
const submittedReportIds = new Set();
const postImageInput = document.getElementById("post-image-upload");
const postImageButton = document.getElementById("post-image-button");
const postImagePreviewWrap = document.getElementById("post-image-preview-wrap");
const postImagePreview = document.getElementById("post-image-preview");
const alertsButton = document.getElementById("enable-alerts");
const phoneAlertStatus = document.getElementById("phone-alert-status");
const editUsernameButton = document.getElementById("edit-username");
const spotifyCard = document.querySelector(".spotify-profile-card");
const spotifyPlayerWrap = document.getElementById("spotify-player-wrap");
const spotifyForm = document.getElementById("spotify-song-form");
const spotifyInput = document.getElementById("spotify-song-url");
const spotifyToggle = document.getElementById("spotify-edit-toggle");
const spotifyRemove = document.getElementById("spotify-song-remove");
const spotifyStatus = document.getElementById("spotify-song-status");
const postCategory = document.getElementById("post-category");
const postExpiry = document.getElementById("post-expiry");
const postExpiryPreview = document.getElementById("post-expiry-preview");
const pollOptions = document.getElementById("poll-options");
const postReportDialog = document.getElementById("post-report-dialog");
const postReportForm = document.getElementById("post-report-form");
const cancelPostReport = document.getElementById("cancel-post-report");
const reportSubmissionGate = createReportSubmissionGate();
let dialogReportToken = null;
let submittingReportToken = null;
let selectedPostExpiryMillis = postExpirySelection(postExpiry.value, Date.now());

const notificationRoomMessageListeners = createRoomMessageListenerRegistry({
  subscribe: (roomId, next, error) => onSnapshot(
      query(collection(db, "roomMessages"), where("roomId", "==", roomId)),
      (snapshot) => next(snapshot.docs),
      error
    ),
  onMessages: (messages) => {
    roomMessages = messages;
    renderNotifications();
  },
  onError: () => setStatus("Could not load room-message notifications.", true)
});

const syncNotificationRoomMessageListeners = () => {
  notificationRoomMessageListeners.sync({ rooms, memberships: roomMemberships, currentUid: currentUser?.uid });
};

const stopTimelineListeners = () => {
  listeners.forEach((unsubscribe) => unsubscribe());
  notificationRoomMessageListeners.stop();
};

postCategory?.addEventListener("change", () => {
  pollOptions.hidden = postCategory.value !== "Poll";
});

const renderExpiryPreview = () => {
  postExpiryPreview.textContent = selectedPostExpiryMillis
    ? `Disappears ${new Date(selectedPostExpiryMillis).toLocaleString()}`
    : "This post will not disappear automatically.";
};

const updateExpirySelection = () => {
  selectedPostExpiryMillis = postExpirySelection(postExpiry.value, Date.now());
  renderExpiryPreview();
};

postExpiry.addEventListener("change", updateExpirySelection);

const spotifyTrackId = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return "";
    const match = url.pathname.match(/\/track\/([A-Za-z0-9]{22})(?:\/|$)/);
    return match?.[1] || "";
  } catch {
    return "";
  }
};

const renderSpotifySong = (url = "") => {
  const id = spotifyTrackId(url);
  spotifyPlayerWrap.replaceChildren();
  spotifyPlayerWrap.hidden = !id;
  spotifyCard?.classList.toggle("has-song", Boolean(id));
  spotifyToggle.textContent = id ? "Change song" : "Add song";
  spotifyInput.value = id ? `https://open.spotify.com/track/${id}` : "";
  if (!id) return;
  const frame = document.createElement("iframe");
  frame.src = `https://open.spotify.com/embed/track/${id}?utm_source=generator&theme=0`;
  frame.title = "Spotify profile song";
  frame.loading = "lazy";
  frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  spotifyPlayerWrap.append(frame);
};

spotifyToggle?.addEventListener("click", () => {
  spotifyForm.hidden = !spotifyForm.hidden;
  if (!spotifyForm.hidden) spotifyInput.focus();
});

spotifyForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = spotifyTrackId(spotifyInput.value);
  if (!id) {
    spotifyStatus.textContent = "Paste a valid Spotify song link.";
    return;
  }
  const url = `https://open.spotify.com/track/${id}`;
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { spotifyTrackUrl: url });
    renderSpotifySong(url);
    spotifyForm.hidden = true;
    spotifyStatus.textContent = "Your profile song was saved.";
  } catch {
    spotifyStatus.textContent = "Could not save that song. Please try again.";
  }
});

spotifyRemove?.addEventListener("click", async () => {
  try {
    await updateDoc(doc(db, "users", currentUser.uid), { spotifyTrackUrl: "" });
    renderSpotifySong("");
    spotifyForm.hidden = true;
    spotifyStatus.textContent = "Profile song removed.";
  } catch {
    spotifyStatus.textContent = "Could not remove that song.";
  }
});

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches
  || window.navigator.standalone === true;
const serviceWorkerSupported = "serviceWorker" in navigator;
const pushSupported = "PushManager" in window;

const persistPushSubscription = async ({ id, data }) => {
  await runTransaction(db, async (transaction) => {
    const reference = doc(db, "pushSubscriptions", id);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists()) {
      transaction.set(reference, data);
      return;
    }
    transaction.update(reference, {
      expirationTime: data.expirationTime,
      p256dh: data.p256dh,
      auth: data.auth,
      updatedAt: data.updatedAt
    });
  });
};

const pushAlertsClient = createPushAlertsClient({
  notification: "Notification" in window ? window.Notification : null,
  serviceWorkerSupported,
  pushSupported,
  serviceWorkerReady: serviceWorkerSupported ? navigator.serviceWorker.ready : null,
  publicKey: VAPID_PUBLIC_KEY,
  isIOS,
  isStandalone,
  subtle: window.crypto?.subtle,
  timestamp: serverTimestamp,
  persist: persistPushSubscription,
  remove: ({ id }) => deleteDoc(doc(db, "pushSubscriptions", id)),
  onState: (state) => applyPushAlertState({ state, button: alertsButton, status: phoneAlertStatus })
});

alertsButton?.addEventListener("click", () => {
  if (currentUser) void pushAlertsClient.enableFromGesture(currentUser);
});

editUsernameButton?.addEventListener("click", async () => {
  if (!currentUser || !profileUsername) return;
  const nextUsername = window.prompt("Choose a new anonymous username:", profileUsername)?.trim();
  if (!nextUsername || nextUsername === profileUsername) return;
  if (!/^[A-Za-z0-9_]{3,30}$/.test(nextUsername)) {
    setStatus("Username must be 3–30 letters, numbers, or underscores.", true);
    return;
  }
  const oldNormalized = profileUsername.toLowerCase();
  const nextNormalized = nextUsername.toLowerCase();
  editUsernameButton.disabled = true;
  try {
    await runTransaction(db, async (transaction) => {
      const userRef = doc(db, "users", currentUser.uid);
      const nextRef = doc(db, "usernames", nextNormalized);
      const nextSnapshot = await transaction.get(nextRef);
      if (nextNormalized !== oldNormalized && nextSnapshot.exists()) throw new Error("username-taken");
      if (nextNormalized !== oldNormalized) {
        transaction.set(nextRef, {
          uid: currentUser.uid,
          username: nextUsername,
          createdAt: serverTimestamp()
        });
      }
      transaction.update(userRef, { username: nextUsername });
      if (nextNormalized !== oldNormalized) {
        transaction.delete(doc(db, "usernames", oldNormalized));
      }
    });
    await updateProfile(currentUser, { displayName: nextUsername });
    profileUsername = nextUsername;
    document.getElementById("display-name").textContent = nextUsername;
    document.getElementById("user-handle").textContent = `@${nextUsername}`;
    setStatus("Username updated.");
  } catch (error) {
    setStatus(error.message === "username-taken"
      ? "That username is already taken."
      : "Could not change the username. Please try again.", true);
  } finally {
    editUsernameButton.disabled = false;
  }
});

const compressPostImage = (file) => new Promise((resolve, reject) => {
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
      if (data.length > 780000) {
        reject(new Error("That image is still too large after compression."));
        return;
      }
      resolve(data);
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

postImageButton.addEventListener("click", () => postImageInput.click());

postImageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  setStatus("Preparing your post photo…");
  try {
    pendingPostImage = await compressPostImage(file);
    postImagePreview.src = pendingPostImage;
    postImagePreviewWrap.hidden = false;
    setStatus("Photo ready.");
  } catch (error) {
    pendingPostImage = "";
    setStatus(error.message || "Could not prepare that photo.", true);
  }
});

document.getElementById("remove-post-image").addEventListener("click", () => {
  pendingPostImage = "";
  postImageInput.value = "";
  postImagePreviewWrap.hidden = true;
});

const closeSearch = () => {
  searchResults.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
};

const findPostElement = (postId) =>
  document.getElementById(`post-posts-${postId}`) ||
  document.getElementById(`post-communityPosts-${postId}`);

const openPostFromSearch = (postId) => {
  searchInput.value = "";
  closeSearch();
  setFeedView(false);
  requestAnimationFrame(() => {
    const target = findPostElement(postId);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.classList.add("notification-highlight");
    window.setTimeout(() => target?.classList.remove("notification-highlight"), 1800);
  });
};

const renderSearchResults = () => {
  const term = searchInput.value.trim().toLowerCase();
  if (term.length < 2) {
    closeSearch();
    return;
  }

  const matchedUsers = users
    .filter((profile) => actorIsVisible(profile.id) && profile.data().username?.toLowerCase().includes(term))
    .slice(0, 5);
  const matchedPosts = allTimelinePosts()
    .filter(postIsVisibleByBlock)
    .filter((post) =>
      post.data().content?.toLowerCase().includes(term) ||
      post.data().username?.toLowerCase().includes(term)
    )
    .slice(0, 8);
  const groups = [];

  if (matchedUsers.length) {
    const heading = document.createElement("p");
    heading.className = "search-heading";
    heading.textContent = "Users";
    groups.push(heading, ...matchedUsers.map((profile) => {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = `profile.html?uid=${encodeURIComponent(profile.id)}`;
      link.textContent = `@${profile.data().username}`;
      return link;
    }));
  }

  if (matchedPosts.length) {
    const heading = document.createElement("p");
    heading.className = "search-heading";
    heading.textContent = "Posts";
    groups.push(heading, ...matchedPosts.map((post) => {
      const button = document.createElement("button");
      button.className = "search-result search-post-result";
      button.type = "button";
      const data = post.data();
      button.textContent = `@${data.username || data.originalUsername || "anonymous"}: ${data.content.slice(0, 90)}${data.content.length > 90 ? "…" : ""}`;
      button.addEventListener("click", () => openPostFromSearch(post.id));
      return button;
    }));
  }

  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "search-empty";
    empty.textContent = "No matching users or posts.";
    groups.push(empty);
  }

  searchResults.replaceChildren(...groups);
  searchResults.hidden = false;
  searchInput.setAttribute("aria-expanded", "true");
};

searchInput.addEventListener("input", renderSearchResults);
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    closeSearch();
  }
});

const validProfile = (profile, userId) =>
  profile?.uid === userId &&
  typeof profile.username === "string" &&
  /^[A-Za-z0-9_]{3,30}$/.test(profile.username);

const formatNotificationTime = (timestamp) =>
  timestamp?.toDate ? timestamp.toDate().toLocaleString() : "Just now";

const appendLinkedText = (container, value) => {
  String(value || "").split(/(@[A-Za-z0-9_]{3,30})/g).forEach((part) => {
    if (!part.startsWith("@")) {
      container.append(document.createTextNode(part));
      return;
    }
    const handle = part.slice(1).toLowerCase();
    const profile = users.find((entry) => entry.data().username?.toLowerCase() === handle);
    if (!profile) {
      container.append(document.createTextNode(part));
      return;
    }
    const link = document.createElement("a");
    link.className = "mention-link";
    link.href = `profile.html?uid=${encodeURIComponent(profile.id)}`;
    link.textContent = part;
    container.append(link);
  });
};

const attachMentionAutocomplete = (input) => {
  const host = input.parentElement;
  if (!host) return;
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
    close();
    input.focus();
  };

  const render = () => {
    const cursor = input.selectionStart ?? input.value.length;
    const match = input.value.slice(0, cursor).match(/@([A-Za-z0-9_]*)$/);
    if (!match) {
      close();
      return;
    }
    const queryText = match[1].toLowerCase();
    const matches = users
      .filter((entry) => entry.data().username?.toLowerCase().startsWith(queryText))
      .slice(0, 6);
    if (!matches.length) {
      close();
      return;
    }
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
    if (event.key === "Enter" && !suggestions.hidden && input.tagName !== "TEXTAREA") {
      event.preventDefault();
      suggestions.querySelector("button")?.dispatchEvent(new PointerEvent("pointerdown"));
    }
  });
  input.addEventListener("blur", () => window.setTimeout(close, 120));
};

attachMentionAutocomplete(content);

const mentionsCurrentUser = (value) => {
  if (!profileUsername) return false;
  const target = profileUsername.toLowerCase();
  return (String(value || "").match(/@[A-Za-z0-9_]{3,30}/g) || [])
    .some((handle) => handle.slice(1).toLowerCase() === target);
};

const allTimelinePosts = () => [...postDocs, ...communityPostDocs];
const actorIsVisible = (uid) => uid === currentUser?.uid || (blockPairsInitialized && canShowActorContent(uid, blockPairs));
const canInteractWith = (uid) => uid === currentUser?.uid || (blockPairsInitialized && !isBlockedPair(currentUser?.uid, uid, blockPairs));
const timelinePostKey = (post) => postDocumentKey({
  id: post.id,
  collectionName: post.ref.parent.id
});
const postIsVisibleByBlock = (post) => {
  const data = post.data();
  return !locallyReportedPostIds.has(timelinePostKey(post))
    && postIsVisible(data, Date.now())
    && actorIsVisible(data.authorId)
    && (data.type !== "repost" || actorIsVisible(data.originalAuthorId));
};

const renderNotifications = () => {
  if (!currentUser) return;
  const readIds = new Set(notificationReads.map((read) => read.data().eventId ?? read.data().reactionId));
  const notificationItems = buildInAppNotifications({
    currentUid: currentUser.uid,
    posts: allTimelinePosts().filter(postIsVisibleByBlock),
    reactions: reactions.filter((reaction) => actorIsVisible(reaction.data().uid)),
    comments: comments.filter((comment) => actorIsVisible(comment.data().uid)),
    messageRequests: messageRequests.filter((request) => actorIsVisible(request.data().fromId)),
    rooms,
    roomMessages: roomMessages.filter((message) => actorIsVisible(message.data().senderId)),
    roomMemberships,
    reveals: reveals.filter((reveal) => actorIsVisible(reveal.data().fromId))
  });

  const ownedPostIds = new Set(allTimelinePosts()
    .filter((post) => post.data().type !== "repost" && post.data().authorId === currentUser.uid)
    .map((post) => post.id));
  comments.filter((comment) => actorIsVisible(comment.data().uid)).forEach((comment) => {
    const data = comment.data();
    const postId = comment.ref.parent.parent?.id;
    if (data.uid === currentUser.uid || ownedPostIds.has(postId) || !mentionsCurrentUser(data.text)) return;
    notificationItems.push({
      id: notificationUiId("comment-mention", comment.ref.path, data.createdAt),
      postId,
      createdAt: data.createdAt,
      message: "Someone tagged you in a comment."
    });
  });

  allTimelinePosts().filter(postIsVisibleByBlock).forEach((postDoc) => {
    const post = postDoc.data();
    if (
      post.type === "repost" ||
      post.authorId === currentUser.uid ||
      !mentionsCurrentUser(post.content)
    ) return;
    notificationItems.push({
      id: notificationUiId("post-mention", postDoc.ref.path, post.createdAt),
      postId: postDoc.id,
      createdAt: post.createdAt,
      message: "Someone tagged you in a post."
    });
  });

  const items = notificationItems
    .filter((item) => !readIds.has(item.id))
    .sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
    );

  currentNotificationIds = items.map((item) => item.id);
  const unseenCount = currentNotificationIds.filter((id) => !seenNotificationIds.has(id)).length;
  notificationBadge.textContent = unseenCount > 99 ? "99+" : String(unseenCount);
  notificationBadge.hidden = unseenCount === 0;
  notificationList.replaceChildren(...items.map((notification) => {
    const item = document.createElement("li");
    const open = document.createElement("button");
    open.className = "notification-item";
    open.type = "button";
    const message = document.createElement("span");
    message.className = "notification-message";
    message.textContent = notification.message;
    const time = document.createElement("time");
    time.textContent = formatNotificationTime(notification.createdAt);
    open.append(message, time);
    open.addEventListener("click", async () => {
      open.disabled = true;
      try {
        await setDoc(doc(db, "notificationReads", `${currentUser.uid}_${notification.id}`), {
          uid: currentUser.uid,
          eventId: notification.id,
          readAt: serverTimestamp()
        });
        notificationPanel.hidden = true;
        notificationButton.setAttribute("aria-expanded", "false");
        if (!notification.postId && notification.url) {
          window.location.href = notification.url;
          return;
        }
        setFeedView(false);
        requestAnimationFrame(() => {
          const target = findPostElement(notification.postId);
          target?.scrollIntoView({ behavior: "smooth", block: "center" });
          target?.classList.add("notification-highlight");
          window.setTimeout(() => target?.classList.remove("notification-highlight"), 1800);
        });
      } catch {
        setStatus("Could not clear that notification.", true);
        open.disabled = false;
      }
    });
    item.append(open);
    return item;
  }));

  if (!items.length) {
    const empty = document.createElement("li");
    empty.className = "notification-empty";
    empty.textContent = "No new reactions, comments, tags, room messages, message requests, or reveal requests.";
    notificationList.append(empty);
  }
};

notificationButton.addEventListener("click", () => {
  const opening = notificationPanel.hidden;
  notificationPanel.hidden = !opening;
  notificationButton.setAttribute("aria-expanded", String(opening));
  if (opening && currentUser) {
    markNotificationsSeen({
      getStorage: () => window.localStorage,
      uid: currentUser.uid,
      seenIds: seenNotificationIds,
      currentIds: currentNotificationIds
    });
    notificationBadge.hidden = true;
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".topbar-search")) closeSearch();
  if (!notificationPanel.hidden && !event.target.closest(".notification-center")) {
    notificationPanel.hidden = true;
    notificationButton.setAttribute("aria-expanded", "false");
  }
});

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#fca5a5" : "inherit";
};

const canInteractWithPost = (postKey, targetUid) =>
  !locallyReportedPostIds.has(postKey) && canInteractWith(targetUid);

const openPostReportDialog = (postDoc, button) => {
  const post = postDoc.data();
  const target = postReportTarget({
    id: postDoc.id,
    collectionName: postDoc.ref.parent.id,
    post
  });
  const reportKey = reportId(target.targetType, target.id, currentUser.uid);
  const moderationKey = postDocumentKey(target);
  if (reportSubmissionGate.isBusy()) {
    setStatus("Another report is still being submitted. Please wait.");
    return;
  }
  if (
    target.authorId === currentUser.uid ||
    submittedReportIds.has(reportKey) ||
    locallyReportedPostIds.has(moderationKey)
  ) {
    button.disabled = true;
    return;
  }
  dialogReportToken = reportSubmissionGate.tryStart({
    target,
    button,
    reportKey,
    moderationKey
  });
  if (!dialogReportToken) return;
  postReportForm.reset();
  postReportDialog.showModal();
};

cancelPostReport.addEventListener("click", () => {
  if (dialogReportToken) reportSubmissionGate.finish(dialogReportToken);
  dialogReportToken = null;
  postReportDialog.close();
});

postReportDialog.addEventListener("close", () => {
  if (dialogReportToken && dialogReportToken !== submittingReportToken) {
    reportSubmissionGate.finish(dialogReportToken);
    dialogReportToken = null;
  }
});

postReportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!dialogReportToken || submittingReportToken) return;
  const reason = new FormData(postReportForm).get("reason");
  if (typeof reason !== "string" || !reason) return;

  const token = dialogReportToken;
  const { target, button, reportKey, moderationKey } = token.request;
  const timestamp = serverTimestamp();
  const buildPayloads = target.targetType === "communityPost"
    ? communityPostReportPayloads
    : postReportPayloads;
  const payloads = buildPayloads({
    targetId: target.id,
    reporterId: currentUser.uid,
    authorId: target.authorId,
    reason,
    timestamp
  });
  const batch = writeBatch(db);
  batch.set(doc(db, "reports", reportKey), payloads.report);
  batch.update(doc(db, target.collectionName, target.id), payloads[target.targetKey]);

  submittingReportToken = token;
  dialogReportToken = null;
  button.disabled = true;
  button.textContent = "Reported";
  submittedReportIds.add(reportKey);
  locallyReportedPostIds.add(moderationKey);
  postReportDialog.close();
  renderFeed();
  renderSearchResults();
  try {
    await batch.commit();
    setStatus("Post reported. Expiration is paused for admin review.");
  } catch {
    submittedReportIds.delete(reportKey);
    locallyReportedPostIds.delete(moderationKey);
    button.disabled = false;
    button.textContent = "Report";
    renderFeed();
    renderSearchResults();
    setStatus("Could not report that post. It may already be under review.", true);
  } finally {
    reportSubmissionGate.finish(token);
    if (submittingReportToken === token) submittingReportToken = null;
  }
});

const originalPostId = (postDoc) =>
  postDoc.data().type === "repost" ? postDoc.data().originalPostId : postDoc.id;

const postReactions = (collectionName, postId) => reactions.filter((reaction) =>
  reaction.ref.parent.parent?.id === postId
  && reaction.ref.parent.parent?.parent.id === collectionName
  && actorIsVisible(reaction.data().uid)
);

const postComments = (collectionName, postId) => comments
  .filter((comment) => comment.ref.parent.parent?.id === postId
    && comment.ref.parent.parent?.parent.id === collectionName
    && actorIsVisible(comment.data().uid))
  .sort((a, b) =>
    (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0)
  );

const followerCount = (userId) =>
  follows.filter((follow) => follow.data().followingId === userId).length;

const isFollowing = (userId) =>
  follows.some((follow) =>
    follow.data().followerId === currentUser.uid && follow.data().followingId === userId
  );

const toggleFollow = async (userId) => {
  const followRef = doc(db, "follows", `${currentUser.uid}_${userId}`);
  if (isFollowing(userId)) {
    await deleteDoc(followRef);
  } else {
    await setDoc(followRef, {
      followerId: currentUser.uid,
      followingId: userId,
      createdAt: serverTimestamp()
    });
  }
};

const createFollowControl = (userId) => {
  const wrapper = document.createElement("div");
  wrapper.className = "follow-control";
  const count = followerCount(userId);

  if (userId === currentUser.uid) {
    const label = document.createElement("span");
    label.className = "follower-count";
    label.textContent = `${count} ${count === 1 ? "follower" : "followers"}`;
    wrapper.append(label);
    return wrapper;
  }

  const button = document.createElement("button");
  button.className = "follow-button";
  button.type = "button";
  button.setAttribute("aria-pressed", String(isFollowing(userId)));
  button.textContent = `${isFollowing(userId) ? "Following" : "Follow"} · ${count}`;
  button.title = `${count} ${count === 1 ? "follower" : "followers"}`;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await toggleFollow(userId);
    } catch {
      setStatus("Could not update that follow.", true);
      button.disabled = false;
    }
  });
  wrapper.append(button);
  return wrapper;
};

const toggleReaction = async (collectionName, postId, postKey, type, currentType, targetUid) => {
  if (!canInteractWith(targetUid)) return;
  if (!canInteractWithPost(postKey, targetUid)) return;
  const reactionRef = doc(db, collectionName, postId, "reactions", currentUser.uid);
  if (currentType === type) {
    await deleteDoc(reactionRef);
    return;
  }
  await setDoc(reactionRef, {
    uid: currentUser.uid,
    type,
    createdAt: serverTimestamp()
  });
};

const reactionButton = (collectionName, postId, postKey, type, emoji, reactionDocs, targetUid) => {
  const count = reactionDocs.filter((reaction) => reaction.data().type === type).length;
  const myReaction = reactionDocs.find((reaction) => reaction.data().uid === currentUser.uid);
  const currentType = myReaction?.data().type;
  const selected = currentType === type;
  const button = document.createElement("button");
  button.className = "reaction-button";
  button.type = "button";
  button.textContent = `${emoji} ${count}`;
  button.setAttribute("aria-pressed", String(selected));
  button.title = selected
    ? "Remove this reaction"
    : currentType
      ? `Change your reaction to ${emoji}`
      : `React ${emoji}`;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await toggleReaction(collectionName, postId, postKey, type, currentType, targetUid);
    } catch {
      setStatus("Could not update your reaction.", true);
      button.disabled = false;
    }
  });
  return button;
};

const sharePost = async (postDoc) => {
  const post = postDoc.data();
  const sourceId = originalPostId(postDoc);
  const sourceAuthorId = post.type === "repost" ? post.originalAuthorId : post.authorId;
  if (!canInteractWithPost(timelinePostKey(postDoc), sourceAuthorId)) return;
  const sourceUsername = post.type === "repost" ? post.originalUsername : post.username;
  const repostRef = doc(db, "posts", `repost_${currentUser.uid}_${sourceId}`);

  await setDoc(repostRef, {
    type: "repost",
    authorId: currentUser.uid,
    username: profileUsername,
    originalPostId: sourceId,
    originalAuthorId: sourceAuthorId,
    originalUsername: sourceUsername,
    content: post.content,
    imageData: post.imageData || "",
    moderationStatus: "active",
    createdAt: serverTimestamp()
  });
};

const renderPost = (postDoc) => {
  const post = postDoc.data();
  const sourceId = originalPostId(postDoc);
  const collectionName = postDoc.ref.parent.id;
  const sourceCollection = collectionName === "communityPosts" ? "communityPosts" : "posts";
  const interactionPostId = postInteractionTarget({ ...post, id: postDoc.id });
  const interactionPostKey = postDocumentKey({ id: interactionPostId, collectionName: sourceCollection });
  const item = document.createElement("li");
  item.className = "feed-item";
  item.id = `post-${sourceCollection}-${postDoc.id}`;

  if (post.type === "repost") {
    const repostLabel = document.createElement("p");
    repostLabel.className = "repost-label";
    repostLabel.textContent = `↗ @${post.username} shared this`;
    item.append(repostLabel);
  }

  const displayedAuthorId = post.type === "repost" ? post.originalAuthorId : post.authorId;
  if (!postIsVisibleByBlock(postDoc) || !actorIsVisible(displayedAuthorId)) return document.createDocumentFragment();
  const displayedUsername = post.type === "repost" ? post.originalUsername : post.username;
  const authorRow = document.createElement("div");
  authorRow.className = "post-author-row";
  const author = document.createElement("a");
  author.className = "author-link";
  author.href = `profile.html?uid=${encodeURIComponent(displayedAuthorId)}`;
  author.textContent = `@${displayedUsername}`;
  authorRow.append(author, createFollowControl(displayedAuthorId));
  const text = document.createElement("p");
  appendLinkedText(text, post.content);
  const imagePresentation = postImagePresentation(post.imageData, "Photo attached to this post");
  const postImage = imagePresentation.kind === "image"
    ? document.createElement("img")
    : imagePresentation.kind === "placeholder"
      ? document.createElement("p")
      : null;
  if (imagePresentation.kind === "image") {
    postImage.className = "post-image";
    postImage.src = imagePresentation.src;
    postImage.alt = imagePresentation.alt;
    postImage.referrerPolicy = imagePresentation.referrerPolicy;
  } else if (imagePresentation.kind === "placeholder") {
    postImage.className = "post-image-placeholder";
    postImage.textContent = imagePresentation.text;
  }
  const time = document.createElement("small");
  const expiresAt = post.expiresAt?.toMillis?.();
  const expirationCopy = expiresAt ? `Disappears ${new Date(expiresAt).toLocaleString()}` : "";
  time.textContent = (post.createdAt?.toDate
    ? post.createdAt.toDate().toLocaleString()
    : "Posting…") + (expirationCopy ? ` · ${expirationCopy}` : "");

  if (post.category && post.category !== "Post") {
    const category = document.createElement("span");
    category.className = "post-category-pill";
    category.textContent = post.category;
    item.append(category);
  }

  const reactionDocs = postReactions(sourceCollection, interactionPostId);
  const reactionsBar = document.createElement("div");
  reactionsBar.className = "reactions";
  if (sourceCollection === "posts") {
    reactionsBar.append(
      reactionButton(sourceCollection, interactionPostId, interactionPostKey, "heart", "❤️", reactionDocs, displayedAuthorId),
      reactionButton(sourceCollection, interactionPostId, interactionPostKey, "middle_finger", "🖕", reactionDocs, displayedAuthorId),
      reactionButton(sourceCollection, interactionPostId, interactionPostKey, "laugh", "😂", reactionDocs, displayedAuthorId),
      reactionButton(sourceCollection, interactionPostId, interactionPostKey, "sad", "😢", reactionDocs, displayedAuthorId)
    );
  }

  const poll = document.createElement("div");
  poll.className = "timeline-poll";
  if (post.category === "Poll" && Array.isArray(post.options)) {
    const knownTargets = {
      postIds: new Set(postDocs.map(document => document.id)),
      communityPostIds: new Set(communityPostDocs.map(document => document.id))
    };
    const voteTarget = { postCollection: sourceCollection, postId: interactionPostId };
    const votes = pollVotes.filter(vote => voteBelongsToTarget(vote.data(), voteTarget, knownTargets));
    const mine = votes.find((vote) => vote.data().uid === currentUser.uid);
    post.options.forEach((option, index) => {
      const count = votes.filter((vote) => vote.data().option === index).length;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-pressed", String(mine?.data().option === index));
      const label = document.createElement("span");
      label.textContent = option;
      const total = document.createElement("strong");
      total.textContent = `${count} vote${count === 1 ? "" : "s"}`;
      button.append(label, total);
      button.addEventListener("click", async () => {
        if (!canInteractWithPost(interactionPostKey, displayedAuthorId)) return;
        button.disabled = true;
        const plan = voteDocumentPlan({
          postCollection: sourceCollection,
          postId: interactionPostId,
          uid: currentUser.uid,
          option: index,
          createdAt: serverTimestamp()
        });
        const voteRef = doc(db, "communityVotes", plan.id);
        try {
          const batch = writeBatch(db);
          if (mine?.data().option === index) batch.delete(mine.ref);
          else {
            if (mine && mine.id !== plan.id) batch.delete(mine.ref);
            batch.set(voteRef, plan.data);
          }
          await batch.commit();
        } catch {
          setStatus("Could not update your vote.", true);
          button.disabled = false;
        }
      });
      poll.append(button);
    });
  }

  const commentDocs = postComments(sourceCollection, interactionPostId);
  const commentsSection = document.createElement("details");
  commentsSection.className = "comments-section";
  const commentsSummary = document.createElement("summary");
  commentsSummary.textContent = `Comments · ${commentDocs.length}`;
  const commentsList = document.createElement("ul");
  commentsList.className = "comments-list";

  commentDocs.forEach((commentDoc) => {
    const comment = commentDoc.data();
    const commentItem = document.createElement("li");
    commentItem.className = "comment-item";
    const commenter = document.createElement("a");
    commenter.className = "comment-author";
    commenter.href = `profile.html?uid=${encodeURIComponent(comment.uid)}`;
    commenter.textContent = `@${comment.username || "anonymous"}`;
    const commentText = document.createElement("p");
    appendLinkedText(commentText, comment.text);
    const commentTime = document.createElement("time");
    commentTime.textContent = comment.createdAt?.toDate
      ? comment.createdAt.toDate().toLocaleString()
      : "Posting…";
    const commentActions = document.createElement("div");
    commentActions.className = "comment-actions";
    const reply = document.createElement("button");
    reply.type = "button";
    reply.textContent = "Reply";
    reply.addEventListener("click", () => {
      commentInput.value = `@${comment.username || "anonymous"} `;
      commentsSection.open = true;
      commentInput.focus();
      commentInput.setSelectionRange(commentInput.value.length, commentInput.value.length);
    });
    commentActions.append(reply);
    if (comment.uid === currentUser.uid || post.authorId === currentUser.uid) {
      const removeComment = document.createElement("button");
      removeComment.type = "button";
      removeComment.className = "delete-comment-button";
      removeComment.textContent = "Delete";
      removeComment.addEventListener("click", async () => {
        removeComment.disabled = true;
        try {
          await deleteDoc(commentDoc.ref);
        } catch {
          setStatus("Could not delete that comment.", true);
          removeComment.disabled = false;
        }
      });
      commentActions.append(removeComment);
    }
    commentItem.append(commenter, commentText, commentTime, commentActions);
    commentsList.append(commentItem);
  });

  const commentForm = document.createElement("form");
  commentForm.className = "comment-form";
  const commentInput = document.createElement("input");
  commentInput.type = "text";
  commentInput.maxLength = 280;
  commentInput.required = true;
  commentInput.placeholder = "Comment or tag @username…";
  commentInput.setAttribute("aria-label", "Write a comment");
  const commentSubmit = document.createElement("button");
  commentSubmit.type = "submit";
  commentSubmit.textContent = "Comment";
  commentForm.append(commentInput, commentSubmit);
  attachMentionAutocomplete(commentInput);
  commentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = commentInput.value.trim();
    if (!text || !canInteractWithPost(interactionPostKey, displayedAuthorId)) return;
    commentSubmit.disabled = true;
    try {
      await addDoc(collection(db, sourceCollection, interactionPostId, "comments"), {
        uid: currentUser.uid,
        username: profileUsername,
        text,
        createdAt: serverTimestamp()
      });
      commentInput.value = "";
      commentsSection.open = true;
    } catch {
      setStatus("Could not post your comment.", true);
    } finally {
      commentSubmit.disabled = false;
    }
  });

  commentsSection.append(commentsSummary, commentsList, commentForm);

  const actions = document.createElement("div");
  actions.className = "post-actions";
  const repostId = `repost_${currentUser.uid}_${sourceId}`;
  const alreadyShared = postDocs.some((candidate) => candidate.id === repostId);

  if (sourceCollection === "posts" && (post.type === "repost" ? post.originalAuthorId : post.authorId) !== currentUser.uid) {
    const share = document.createElement("button");
    share.className = "share-button";
    share.type = "button";
    share.textContent = alreadyShared ? "Shared to profile" : "Share to profile";
    share.disabled = alreadyShared;
    share.addEventListener("click", async () => {
      share.disabled = true;
      try {
        await sharePost(postDoc);
      } catch {
        setStatus("Could not share that post.", true);
        share.disabled = false;
      }
    });
    actions.append(share);
  }

  if (post.authorId !== currentUser.uid) {
    const report = document.createElement("button");
    const target = postReportTarget({ id: postDoc.id, collectionName: sourceCollection, post });
    const reportKey = reportId(target.targetType, target.id, currentUser.uid);
    report.className = "report-button";
    report.type = "button";
    report.textContent = submittedReportIds.has(reportKey) ? "Reported" : "Report";
    report.disabled = submittedReportIds.has(reportKey);
    report.addEventListener("click", () => openPostReportDialog(postDoc, report));
    actions.append(report);
  }

  if (post.authorId === currentUser.uid) {
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = post.type === "repost" ? "Remove from profile" : "Delete";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await deleteDoc(doc(db, collectionName, postDoc.id));
      } catch {
        setStatus("Could not remove that post.", true);
        remove.disabled = false;
      }
    });
    actions.append(remove);
  }

  item.append(authorRow, text);
  if (postImage) item.append(postImage);
  item.append(time);
  if (poll.childElementCount) item.append(poll);
  if (reactionsBar.childElementCount) item.append(reactionsBar);
  item.append(commentsSection, actions);
  return item;
};

const renderFeed = () => {
  const unexpiredPosts = allTimelinePosts()
    .filter(postIsVisibleByBlock)
    .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
  const visiblePosts = showingProfile
    ? unexpiredPosts.filter((post) => post.data().authorId === currentUser.uid)
    : unexpiredPosts;

  feed.replaceChildren(...visiblePosts.map(renderPost));
  renderNotifications();
  setStatus(visiblePosts.length
    ? ""
    : showingProfile
      ? "You have not posted or shared anything yet."
      : "No posts yet. Start the conversation.");
};

const setFeedView = (profileOnly) => {
  showingProfile = profileOnly;
  allPostsButton.setAttribute("aria-pressed", String(!profileOnly));
  profilePostsButton.setAttribute("aria-pressed", String(profileOnly));
  document.getElementById("feed-title").textContent = profileOnly ? "My profile posts" : "Latest posts";
  renderFeed();
};

allPostsButton.addEventListener("click", () => setFeedView(false));
profilePostsButton.addEventListener("click", () => setFeedView(true));

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    stopTimelineListeners();
    await exitAfterAuthLoss({
      redirect: () => window.location.replace("index.html")
    });
    return;
  }

  currentUser = user;
  loadBlockPairs({ db, uid: user.uid, onChange: (pairs) => {
    blockPairs = pairs;
    blockPairsInitialized = true;
    renderFeed();
    renderSearchResults();
  }, onError: () => setStatus("Could not load block settings.", true) }).then((unsubscribe) => listeners.push(unsubscribe)).catch(() => setStatus("Could not load block settings.", true));
  seenNotificationIds = readSeenNotificationIds({ getStorage: () => window.localStorage, uid: user.uid });
  const profileRef = doc(db, "users", user.uid);
  let profile = await getDoc(profileRef);
  if (profile.exists() && profile.data().banned === true) {
    setStatus("This account has been banned.", true);
    await exitAuthenticatedSession({
      user,
      stopListeners: stopTimelineListeners,
      redirect: () => window.location.replace("index.html")
    });
    return;
  }
  if (!profile.exists() || !validProfile(profile.data(), user.uid)) {
    profileUsername = await ensureUserProfile(user, db);
    profile = await getDoc(profileRef);
  } else {
    profileUsername = profile.data().username;
  }
  void pushAlertsClient.reconcileExisting(user);
  void recordPageActivity({
    surface: "timeline",
    profile: profile.data(),
    user,
    db,
    firestore: { doc, updateDoc, serverTimestamp }
  });
  renderSpotifySong(profile.data().spotifyTrackUrl || "");
  document.getElementById("display-name").textContent = profileUsername || "AnonChat user";
  document.getElementById("user-handle").textContent = profileUsername ? `@${profileUsername}` : "";
  document.getElementById("my-profile-link").href =
    `profile.html?uid=${encodeURIComponent(user.uid)}`;
  document.getElementById("admin-link").hidden =
    !["i_love_you_h", "cybercapone"].includes(profileUsername.toLowerCase());
  const statsRef = doc(db, "system", "accountStats");
  if (!(await getDoc(statsRef)).exists()) {
    await setDoc(statsRef, {
      count: 5,
      limit: 500,
      updatedAt: serverTimestamp()
    }).catch(() => {});
  }
  const viewDay = new Date().toISOString().slice(0, 10);
  setDoc(doc(db, "pageViews", viewDay), {
    date: viewDay,
    views: increment(1),
    updatedAt: serverTimestamp()
  }, { merge: true }).catch(() => {});

  listeners.push(onSnapshot(
    query(
      collection(db, "posts"),
      where("moderationStatus", "==", "active"),
      orderBy("createdAt", "desc"),
      limit(100)
    ),
    (snapshot) => {
      postDocs = snapshot.docs;
      renderFeed();
      renderSearchResults();
    },
    () => setStatus("Could not load posts.", true)
  ));

  listeners.push(onSnapshot(
    query(
      collection(db, "communityPosts"),
      where("moderationStatus", "==", "active"),
      orderBy("createdAt", "desc"),
      limit(100)
    ),
    (snapshot) => {
      communityPostDocs = snapshot.docs;
      renderFeed();
    },
    () => setStatus("Could not load earlier community posts.", true)
  ));

  listeners.push(onSnapshot(
    collection(db, "communityVotes"),
    (snapshot) => {
      pollVotes = snapshot.docs;
      renderFeed();
    },
    () => setStatus("Could not load poll votes.", true)
  ));

  listeners.push(onSnapshot(
    collectionGroup(db, "reactions"),
    (snapshot) => {
      reactions = snapshot.docs;
      renderFeed();
    },
    () => setStatus("Could not load reactions.", true)
  ));

  listeners.push(onSnapshot(
    collectionGroup(db, "comments"),
    (snapshot) => {
      comments = snapshot.docs;
      renderFeed();
    },
    () => setStatus("Could not load comments.", true)
  ));

  listeners.push(onSnapshot(
    collection(db, "users"),
    (snapshot) => {
      users = snapshot.docs;
      renderNotifications();
      renderSearchResults();
    },
    () => setStatus("Could not load notification names.", true)
  ));

  listeners.push(onSnapshot(
    query(collection(db, "notificationReads"), where("uid", "==", user.uid)),
    (snapshot) => {
      notificationReads = snapshot.docs;
      renderNotifications();
    },
    () => setStatus("Could not load cleared notifications.", true)
  ));

  listeners.push(onSnapshot(
    collection(db, "follows"),
    (snapshot) => {
      follows = snapshot.docs;
      renderFeed();
    },
    () => setStatus("Could not load follower counts.", true)
  ));

  listeners.push(onSnapshot(
    query(collection(db, "messageRequests"), where("toId", "==", user.uid)),
    (snapshot) => {
      messageRequests = snapshot.docs;
      renderNotifications();
    },
    () => setStatus("Could not load message-request notifications.", true)
  ));

  listeners.push(onSnapshot(
    query(collection(db, "roomMembers"), where("uid", "==", user.uid)),
    (snapshot) => {
      roomMemberships = snapshot.docs;
      syncNotificationRoomMessageListeners();
    },
    () => setStatus("Could not load room memberships.", true)
  ));

  listeners.push(onSnapshot(
    query(collection(db, "rooms"), where("moderationStatus", "==", "active")),
    (snapshot) => {
      rooms = snapshot.docs;
      syncNotificationRoomMessageListeners();
    },
    () => {
      rooms = [];
      syncNotificationRoomMessageListeners();
      setStatus("Could not load active rooms for notifications.", true);
    }
  ));

  listeners.push(onSnapshot(
    query(collection(db, "reveals"), where("toId", "==", user.uid)),
    (snapshot) => {
      reveals = snapshot.docs;
      renderNotifications();
    },
    () => setStatus("Could not load reveal-request notifications.", true)
  ));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const postContent = content.value.trim();
  if (!currentUser || (!postContent && !pendingPostImage) || postContent.length > 500) return;

  const category = postCategory.value;
  const options = [...document.querySelectorAll(".poll-option")]
    .map((input) => input.value.trim())
    .filter(Boolean);
  if (category === "Poll" && options.length < 2) {
    setStatus("Add at least two poll choices.", true);
    return;
  }
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await addDoc(collection(db, "posts"), {
      type: "original",
      authorId: currentUser.uid,
      username: profileUsername,
      content: postContent,
      imageData: pendingPostImage,
      category,
      options: category === "Poll" ? options : [],
      moderationStatus: "active",
      expiresAt: postExpiryTimestamp(selectedPostExpiryMillis, (millis) => Timestamp.fromMillis(millis)),
      createdAt: serverTimestamp()
    });
    content.value = "";
    pendingPostImage = "";
    postImageInput.value = "";
    postImagePreviewWrap.hidden = true;
    postCategory.value = "Post";
    postExpiry.value = "0";
    updateExpirySelection();
    pollOptions.hidden = true;
  } catch {
    setStatus("Could not publish your post.", true);
  } finally {
    submit.disabled = false;
  }
});

document.getElementById("sign-out").addEventListener("click", async () => {
  await exitAuthenticatedSession({
    user: currentUser,
    stopListeners: stopTimelineListeners,
    redirect: () => window.location.replace("index.html")
  });
});
