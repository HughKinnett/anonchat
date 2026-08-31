import { auth, db } from "./firebase-config.js";
import { isDesignatedAdmin } from "./designated-admin-policy.mjs";
import { premiumLabel } from "./premium-policy.mjs";
import { buildOriginalPost, buildRepost } from "./content-writer-policy.mjs";
import { ensureUserProfile } from "./legacy-profile.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { VAPID_PUBLIC_KEY } from "./push-config.mjs";
import { createPushAlertsClient } from "./push-client.mjs";
import { applyPushAlertState } from "./push-alert-ui.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { markNotificationsSeen, readSeenNotificationIds } from "./notification-storage.mjs";
import { buildInAppNotifications, notificationUiId } from "./notification-ui-policy.mjs";
import { createModerationClient } from "./moderation-client.mjs";
import { REPORT_BUTTON_CLASS, REPORT_REASONS } from "./moderation-policy.mjs";
import { compareNewestFirst, compareOldestFirst } from "./content-ordering.mjs";
import { interactionParentForPost } from "./interaction-parent-policy.mjs";
import { pollVoteDocumentId as voteDocumentId } from "./poll-vote-policy.mjs";
import { scheduleExpiryBoundary } from "./temporary-room-timer-policy.mjs";
import { createViewerBlockTracker, isBlockedActor, isBlockedPost, visibleRecords } from "./viewer-block-policy.mjs";
import { createSessionGeneration } from "./session-generation-policy.mjs";
import {
  boundedInteractionCount,
  interactionParentLoadState,
  interactionParentStateMessage,
  MAX_INTERACTION_ITEMS_PER_PARENT,
  MAX_INTERACTION_PARENTS,
  timelineInteractionPlan
} from "./timeline-interaction-policy.mjs";
import { onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
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
  where,
  writeBatch
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
let pollVoteListeners = [];
let pollVoteGeneration = 0;
let messageRequests = [];
let roomMessages = [];
let roomMemberships = [];
let reveals = [];
let blockTracker = createViewerBlockTracker();
let viewerBlocks = blockTracker.current();
const interactionSubscriptions = new Map();
const manuallyLoadedInteractionPaths = new Set();
let interactionGeneration = 0;
let interactionRenderQueued = false;
const sessionGeneration = createSessionGeneration();
let activeTimelineSession = 0;
let clearNotificationExpiryTimer = () => {};
let showingProfile = false;
const TIMELINE_POST_LIMIT = window.matchMedia("(max-width: 700px)").matches ? 25 : 60;
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
const postImageInput = document.getElementById("post-image-upload");
const postImageLabel = document.querySelector("label[for='post-image-upload']");
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
const pollOptions = document.getElementById("poll-options");
let moderationClient;
let reportDialog;
let activeReportTarget;
let reportSubmitting = false;
const reportCardStatuses = new Map();
const pendingPostDeletes = new Set();
const postDeleteStatuses = new Map();

const blockedUid = (uid) => isBlockedActor(uid, viewerBlocks);
const visibleTimelinePosts = () => allTimelinePosts()
  .filter((post) => !post.data().expiresAt?.toMillis?.() || post.data().expiresAt.toMillis() > Date.now())
  .filter((post) => isBlockedPost(post, viewerBlocks))
  .filter((post) => reportCardStatuses.get(post.ref.path)?.hidden !== true);
const syncReportedHolds = (collectionName, documents) => {
  const visiblePaths = new Set(documents.map((entry) => entry.ref.path));
  for (const [path, reportState] of reportCardStatuses) {
    if (reportState.hidden === true && path.startsWith(`${collectionName}/`) && !visiblePaths.has(path)) reportCardStatuses.delete(path);
  }
};
const visibleUsers = () => visibleRecords(users, viewerBlocks, ["uid"]);
const visibleFollows = () => visibleRecords(follows, viewerBlocks, ["followerId", "followingId"]);

postCategory?.addEventListener("change", () => {
  pollOptions.hidden = postCategory.value !== "Poll";
});

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
const isAndroid = /android/i.test(navigator.userAgent);
const isStandalone = window.matchMedia("(display-mode: standalone)").matches
  || window.navigator.standalone === true;
const serviceWorkerSupported = "serviceWorker" in navigator;
const pushSupported = "PushManager" in window;
const pushServiceWorkerReady = serviceWorkerSupported
  ? navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
      .then((registration) => {
        void registration.update();
        return navigator.serviceWorker.ready;
      })
  : null;

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
  serviceWorkerReady: pushServiceWorkerReady,
  publicKey: VAPID_PUBLIC_KEY,
  isIOS,
  isAndroid,
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

const setPhotoSelected = (selected) => {
  postImageLabel?.classList.toggle("is-selected", selected);
  postImageLabel?.setAttribute("aria-pressed", String(selected));
};

postImageLabel?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  postImageInput.click();
});

postImageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  setStatus("Preparing your post photo…");
  try {
    pendingPostImage = await compressPostImage(file);
    postImagePreview.src = pendingPostImage;
    postImagePreviewWrap.hidden = false;
    setPhotoSelected(true);
    setStatus("Photo ready.");
  } catch (error) {
    pendingPostImage = "";
    setPhotoSelected(false);
    setStatus(error.message || "Could not prepare that photo.", true);
  }
});

document.getElementById("remove-post-image").addEventListener("click", () => {
  pendingPostImage = "";
  postImageInput.value = "";
  postImagePreviewWrap.hidden = true;
  setPhotoSelected(false);
});

const closeSearch = () => {
  searchResults.hidden = true;
  searchInput.setAttribute("aria-expanded", "false");
};

const findPostElement = (postId) =>
  document.getElementById(`post-posts-${postId}`) ||
  document.getElementById(`post-communityPosts-${postId}`) ||
  visibleTimelinePosts().map((post) => ({ post, parent: interactionParentForPost(post) }))
    .filter(({ parent }) => parent.id === postId)
    .map(({ post }) => document.getElementById(`post-${post.ref.parent.id}-${post.id}`))
    .find(Boolean);

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
  if (!viewerBlocks.ready) {
    closeSearch();
    return;
  }
  const term = searchInput.value.trim().toLowerCase();
  if (term.length < 2) {
    closeSearch();
    return;
  }

  const matchedUsers = visibleUsers()
    .filter((profile) => profile.data().username?.toLowerCase().includes(term))
    .slice(0, 5);
  const matchedPosts = visibleTimelinePosts()
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
    const profile = visibleUsers().find((entry) => entry.data().username?.toLowerCase() === handle);
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
    const matches = visibleUsers()
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
const allNotificationPosts = () => {
  const byPath = new Map(allTimelinePosts().map((post) => [post.ref.path, post]));
  interactionSubscriptions.forEach((entry) => {
    if (entry.parentDoc) byPath.set(entry.parentDoc.ref.path, entry.parentDoc);
  });
  return [...byPath.values()];
};
const fullyLoadedInteractionRecords = (records) => records.filter((record) =>
  interactionParentLoadState(interactionSubscriptions.get(record.ref.parent.parent?.path)) === "bounded"
);

const compareNotificationsNewestFirst = (left, right) => compareNewestFirst(
  { path: `notificationReads/${left.id}`, data: { createdAt: left.createdAt } },
  { path: `notificationReads/${right.id}`, data: { createdAt: right.createdAt } }
);

const renderNotifications = () => {
  if (!currentUser) { clearNotificationExpiryTimer(); return; }
  if (!viewerBlocks.ready) {
    clearNotificationExpiryTimer();
    currentNotificationIds = [];
    notificationBadge.hidden = true;
    const loading = document.createElement("li");
    loading.className = "notification-empty";
    loading.textContent = "Loading privacy choices…";
    notificationList.replaceChildren(loading);
    return;
  }
  const readIds = new Set(notificationReads.map((read) => read.data().eventId ?? read.data().reactionId));
  const loadedReactions = fullyLoadedInteractionRecords(reactions);
  const loadedComments = fullyLoadedInteractionRecords(comments);
  const notificationItems = buildInAppNotifications({
    currentUid: currentUser.uid,
    posts: allNotificationPosts(),
    reactions: loadedReactions,
    comments: loadedComments,
    messageRequests,
    roomMessages,
    roomMemberships,
    blockedUids: viewerBlocks.blockedUids,
    reveals
  });
  const joinedRoomIds = new Set(roomMemberships.map((membership) => membership.data().roomId));
  const blockedUids = new Set(viewerBlocks.blockedUids);
  clearNotificationExpiryTimer();
  clearNotificationExpiryTimer = scheduleExpiryBoundary({
    expiries: roomMessages.filter((message) => {
      const data = message.data();
      return data.senderId !== currentUser.uid && joinedRoomIds.has(data.roomId) && !blockedUids.has(data.senderId);
    }).map((message) => message.data().expiresAt),
    onBoundary: renderNotifications
  });

  const ownedPostIds = new Set(allNotificationPosts()
    .filter((post) => post.data().type !== "repost" && post.data().authorId === currentUser.uid)
    .map((post) => post.id));
  loadedComments.forEach((comment) => {
    const data = comment.data();
    const postId = comment.ref.parent.parent?.id;
    if (data.uid === currentUser.uid || blockedUid(data.uid) || ownedPostIds.has(postId) || !mentionsCurrentUser(data.text)) return;
    notificationItems.push({
      id: notificationUiId("comment-mention", comment.ref.path, data.createdAt),
      postId,
      createdAt: data.createdAt,
      message: "Someone tagged you in a comment."
    });
  });

  allNotificationPosts().forEach((postDoc) => {
    const post = postDoc.data();
    if (
      post.type === "repost" ||
      post.authorId === currentUser.uid ||
      blockedUid(post.authorId) ||
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
    .sort(compareNotificationsNewestFirst);

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

const createReportDialog = () => {
  if (reportDialog) return reportDialog;
  const dialog = document.createElement("dialog");
  dialog.className = "report-dialog";
  dialog.setAttribute("aria-labelledby", "report-dialog-title");
  const form = document.createElement("form");
  form.method = "dialog";
  const title = document.createElement("h2");
  title.id = "report-dialog-title";
  title.textContent = "Report content";
  const reasonLabel = document.createElement("label");
  reasonLabel.textContent = "Reason";
  const reason = document.createElement("select");
  reason.name = "reason";
  reason.setAttribute("aria-label", "Report reason");
  REPORT_REASONS.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    reason.append(option);
  });
  reasonLabel.append(reason);
  const dialogStatus = document.createElement("p");
  dialogStatus.className = "report-dialog-status";
  dialogStatus.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "report-dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "Submit report";
  cancel.addEventListener("click", () => {
    if (!reportSubmitting) dialog.close();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (reportSubmitting || !activeReportTarget) return;
    const target = activeReportTarget;
    reportSubmitting = true;
    submit.disabled = true;
    cancel.disabled = true;
    dialogStatus.textContent = "Submitting report…";
    try {
      await moderationClient.report(target, reason.value);
      reportCardStatuses.set(target.path, { message: "Report submitted.", isError: false, hidden: true });
      dialog.close();
      activeReportTarget = undefined;
      renderFeed();
    } catch (error) {
      if (error?.code === "already-reported") {
        reportCardStatuses.set(target.path, { message: "This item has already been reported.", isError: false, hidden: true });
        dialog.close();
        activeReportTarget = undefined;
      } else {
        reportCardStatuses.set(target.path, { message: "Could not submit this report. Please try again.", isError: true });
        dialogStatus.textContent = "Could not submit this report. Please try again.";
      }
      renderFeed();
    } finally {
      reportSubmitting = false;
      submit.disabled = false;
      cancel.disabled = false;
    }
  });
  dialog.addEventListener("close", () => {
    if (!reportSubmitting) activeReportTarget = undefined;
  });
  actions.append(cancel, submit);
  form.append(title, reasonLabel, dialogStatus, actions);
  dialog.append(form);
  document.body.append(dialog);
  reportDialog = dialog;
  return dialog;
};

const openReportDialog = async (target) => {
  try {
    if (await moderationClient.hasReported(target)) {
      reportCardStatuses.set(target.path, { message: "This item has already been reported.", isError: false, hidden: true });
      renderFeed();
      return;
    }
    activeReportTarget = target;
    const dialog = createReportDialog();
    dialog.querySelector("form").reset();
    dialog.querySelector(".report-dialog-status").textContent = "";
    dialog.showModal();
  } catch {
    reportCardStatuses.set(target.path, { message: "Could not check report status. Please try again.", isError: true });
    renderFeed();
  }
};

const originalPostId = (postDoc) =>
  postDoc.data().type === "repost" ? postDoc.data().originalPostId : postDoc.id;

const postReactions = (postDoc) => {
  const parent = interactionParentForPost(postDoc);
  return visibleRecords(reactions, viewerBlocks, ["uid"])
    .filter((reaction) => reaction.ref.parent.parent?.path === parent.path);
};

const interactionIsTruncated = (parentPath, kind) =>
  Boolean(interactionSubscriptions.get(parentPath)?.truncated[kind]);

const postComments = (postDoc) => {
  const parent = interactionParentForPost(postDoc);
  return visibleRecords(comments, viewerBlocks, ["uid"])
    .filter((comment) => comment.ref.parent.parent?.path === parent.path)
    .sort(compareOldestFirst);
};

const followerCount = (userId) =>
  visibleFollows().filter((follow) => follow.data().followingId === userId).length;

const isFollowing = (userId) =>
  visibleFollows().some((follow) =>
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

  if (blockedUid(userId)) return wrapper;

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

const toggleReaction = async (parent, type, currentType) => {
  const reactionRef = doc(db, parent.collection, parent.id, "reactions", currentUser.uid);
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

const reactionButton = (parent, type, emoji, reactionDocs) => {
  const myReaction = reactionDocs.find((reaction) => reaction.data().uid === currentUser.uid);
  const currentType = myReaction?.data().type;
  const selected = currentType === type;
  const button = document.createElement("button");
  button.className = "reaction-button";
  button.type = "button";
  button.textContent = emoji;
  button.setAttribute("aria-pressed", String(selected));
  button.title = selected
    ? "Remove this reaction"
    : currentType
      ? `Change your reaction to ${emoji}`
      : `React ${emoji}`;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await toggleReaction(parent, type, currentType);
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
  const sourceUsername = post.type === "repost" ? post.originalUsername : post.username;
  const repostRef = doc(db, "posts", `repost_${currentUser.uid}_${sourceId}`);

  await setDoc(repostRef, buildRepost({
    authorId: currentUser.uid,
    username: profileUsername,
    sourceCollection: interactionParentForPost(postDoc).collection,
    originalPostId: sourceId,
    originalAuthorId: sourceAuthorId,
    originalUsername: sourceUsername,
    content: post.content,
    imageData: post.imageData || "",
    createdAt: serverTimestamp()
  }));
};

const renderPost = (postDoc) => {
  const post = postDoc.data();
  const sourceId = originalPostId(postDoc);
  const parent = interactionParentForPost(postDoc);
  const collectionName = postDoc.ref.parent.id;
  const sourceCollection = collectionName === "communityPosts" ? "communityPosts" : "posts";
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
  const postImage = post.imageData ? document.createElement("img") : null;
  if (postImage) {
    postImage.className = "post-image";
    postImage.src = post.imageData;
    postImage.alt = "Photo attached to this post";
  }
  const time = document.createElement("small");
  const expiresAt = post.expiresAt?.toMillis?.();
  time.textContent = (post.createdAt?.toDate
    ? post.createdAt.toDate().toLocaleString()
    : "Posting…") + (expiresAt ? ` · Disappears ${new Date(expiresAt).toLocaleString()}` : "");

  if (post.category && post.category !== "Post") {
    const category = document.createElement("span");
    category.className = "post-category-pill";
    category.textContent = post.category;
    item.append(category);
  }

  const interactionEntry = interactionSubscriptions.get(parent.path);
  const reactionDocs = postReactions(postDoc);
  const interactionState = interactionParentLoadState(interactionEntry);
  const reactionsReady = Boolean(interactionEntry?.ready?.reactions && interactionEntry?.ready?.viewerReaction);
  const commentsReady = Boolean(interactionEntry?.ready?.comments);
  const reactionsTruncated = interactionIsTruncated(parent.path, "reactions");
  const reactionsBar = document.createElement("div");
  reactionsBar.className = "reactions";
  if (reactionsReady) {
    if (sourceCollection === "posts") {
      reactionsBar.append(
        reactionButton(parent, "heart", "❤️", reactionDocs, reactionsTruncated),
        reactionButton(parent, "middle_finger", "🖕", reactionDocs, reactionsTruncated),
        reactionButton(parent, "laugh", "😂", reactionDocs, reactionsTruncated),
        reactionButton(parent, "sad", "😢", reactionDocs, reactionsTruncated)
      );
    }
  }

  const interactionSummary = document.createElement("details");
  interactionSummary.className = "post-interaction-summary";
  const interactionSummaryLabel = document.createElement("summary");
  const activeReactionTypes = [...new Set(reactionDocs.map((reaction) => reaction.data().type))];
  const reactionEmoji = { heart: "❤️", middle_finger: "🖕", laugh: "😂", sad: "😢" };
  const activeReactionIcons = activeReactionTypes.map((type) => reactionEmoji[type]).filter(Boolean).join(" ");
  interactionSummaryLabel.textContent = `${activeReactionIcons ? `${activeReactionIcons} · ` : ""}${reactionDocs.length}`;
  interactionSummaryLabel.setAttribute("aria-label",
    `${reactionDocs.length} interaction${reactionDocs.length === 1 ? "" : "s"}. Show who interacted.`);
  interactionSummaryLabel.title = "Show who interacted with this post";
  const interactionPeople = document.createElement("ul");
  if (!reactionDocs.length) {
    const emptyInteraction = document.createElement("li");
    emptyInteraction.textContent = "No interactions yet.";
    interactionPeople.append(emptyInteraction);
  } else {
    reactionDocs.forEach((reaction) => {
      const row = document.createElement("li");
      const profile = users.find((user) => user.id === reaction.data().uid)?.data();
      const link = document.createElement("a");
      link.href = `profile.html?uid=${encodeURIComponent(reaction.data().uid)}`;
      link.textContent = `@${profile?.username || "anonymous"}`;
      row.append(link, document.createTextNode(` reacted ${reactionEmoji[reaction.data().type] || "•"}`));
      interactionPeople.append(row);
    });
  }
  interactionSummary.append(interactionSummaryLabel, interactionPeople);

  const poll = document.createElement("div");
  poll.className = "timeline-poll";
  if (post.category === "Poll" && Array.isArray(post.options)) {
    const voteParent = parent;
    const rawVotes = pollVotes.filter((vote) =>
      vote.data().postCollection === voteParent.collection
      && vote.data().postId === voteParent.id
    );
    const votes = [...new Map(rawVotes.map((vote) => [vote.data().uid, vote])).values()];
    const mine = votes.find((vote) => vote.data().uid === currentUser.uid);
    post.options.forEach((option, index) => {
      const count = votes.filter((vote) => vote.data().option === index).length;
      const percentage = votes.length ? Math.round((count / votes.length) * 100) : 0;
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-pressed", String(mine?.data().option === index));
      const label = document.createElement("span");
      label.textContent = option;
      const total = document.createElement("strong");
      total.textContent = `${percentage}% · ${count} vote${count === 1 ? "" : "s"}`;
      button.append(label, total);
      button.addEventListener("click", async () => {
        if (mine?.data().option === index) return;
        button.disabled = true;
        const voteRef = doc(db, "communityVotes", voteDocumentId(voteParent.collection, voteParent.id, currentUser.uid));
        try {
          await setDoc(voteRef, {
            postCollection: voteParent.collection, postId: voteParent.id,
            uid: currentUser.uid, option: index, createdAt: serverTimestamp()
          });
        } catch {
          setStatus("Could not update your vote.", true);
          button.disabled = false;
        }
      });
      poll.append(button);
    });
  }

  let commentsSection;
  if (commentsReady) {
    const commentDocs = postComments(postDoc);
    commentsSection = document.createElement("details");
  commentsSection.className = "comments-section";
  const commentsSummary = document.createElement("summary");
  commentsSummary.textContent = `Comments · ${boundedInteractionCount(
    commentDocs.length, interactionIsTruncated(parent.path, "comments")
  )}`;
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
    if (comment.uid === currentUser.uid || displayedAuthorId === currentUser.uid) {
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
    if (!text) return;
    commentSubmit.disabled = true;
    try {
      await addDoc(collection(db, parent.collection, parent.id, "comments"), {
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
  } else if (interactionState === "unavailable") {
    commentsSection = document.createElement("div");
    commentsSection.hidden = true;
  } else {
    commentsSection = document.createElement("p");
    commentsSection.className = "interaction-load-state muted";
    commentsSection.textContent = interactionParentStateMessage(interactionState);
  }

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

  if (post.authorId === currentUser.uid) {
    const remove = document.createElement("button");
    remove.className = "delete-button";
    remove.type = "button";
    remove.textContent = "Delete";
    const path = postDoc.ref.path;
    remove.disabled = pendingPostDeletes.has(path);
    const deleteStatus = postDeleteStatuses.get(path);
    if (deleteStatus) {
      const message = document.createElement("p");
      message.className = "post-action-status";
      message.setAttribute("role", "status");
      message.textContent = deleteStatus.message;
      if (deleteStatus.isError) message.classList.add("is-error");
      actions.append(message);
    }
    remove.addEventListener("click", async () => {
      if (pendingPostDeletes.has(path)) return;
      if (!window.confirm("Permanently delete this post? This cannot be undone.")) return;
      pendingPostDeletes.add(path);
      postDeleteStatuses.delete(path);
      remove.disabled = true;
      try {
        await deleteDoc(postDoc.ref);
      } catch {
        pendingPostDeletes.delete(path);
        postDeleteStatuses.set(path, { message: "Could not delete this post. Please try again.", isError: true });
        renderFeed();
      }
    });
    actions.append(remove);
  } else {
    const path = postDoc.ref.path;
    const reportStatus = reportCardStatuses.get(path);
    const report = document.createElement("button");
    report.className = REPORT_BUTTON_CLASS;
    report.type = "button";
    report.textContent = "Report";
    report.disabled = Boolean(reportStatus && !reportStatus.isError);
    report.addEventListener("click", async () => {
      report.disabled = true;
      await openReportDialog({
        targetKind: sourceCollection === "communityPosts" ? "communityPost" : "post",
        targetCollection: sourceCollection,
        targetId: postDoc.id,
        reportedUserId: post.authorId,
        path
      });
      if (item.isConnected && !reportCardStatuses.has(path)) report.disabled = false;
    });
    actions.append(report);
    if (reportStatus) {
      const message = document.createElement("p");
      message.className = "post-action-status";
      message.setAttribute("role", "status");
      message.textContent = reportStatus.message;
      if (reportStatus.isError) message.classList.add("is-error");
      actions.append(message);
    }
  }

  item.append(authorRow, text);
  if (postImage) item.append(postImage);
  item.append(time);
  if (poll.childElementCount) item.append(poll);
  if (reactionsBar.childElementCount) item.append(reactionsBar);
  if (reactionsReady) item.append(interactionSummary);
  item.append(commentsSection, actions);
  return item;
};

const renderFeed = () => {
  if (!viewerBlocks.ready) {
    feed.replaceChildren();
    renderNotifications();
    setStatus("Loading privacy choices…");
    return;
  }
  const unexpiredPosts = visibleTimelinePosts().sort(compareNewestFirst);
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

const clearInteractionListeners = () => {
  interactionGeneration += 1;
  interactionSubscriptions.forEach((entry) => {
    entry.sourceUnsubscribe?.();
    entry.childUnsubscribes.forEach((unsubscribe) => unsubscribe());
  });
  interactionSubscriptions.clear();
  manuallyLoadedInteractionPaths.clear();
  reactions = [];
  comments = [];
  interactionRenderQueued = false;
};

const queueInteractionRender = () => {
  if (interactionRenderQueued) return;
  interactionRenderQueued = true;
  const generation = interactionGeneration;
  queueMicrotask(() => {
    interactionRenderQueued = false;
    if (generation !== interactionGeneration) return;
    const loadedEntries = [...interactionSubscriptions.values()];
    reactions = loadedEntries.flatMap((entry) => {
      if (!entry.ready?.reactions) return [];
      if (!entry.viewerReaction) return entry.reactions;
      return [
        ...entry.reactions.filter((reaction) => reaction.ref.path !== entry.viewerReaction.ref.path),
        entry.viewerReaction
      ];
    });
    comments = loadedEntries.flatMap((entry) => entry.ready?.comments ? entry.comments : []);
    renderFeed();
  });
};

const stopInteractionEntry = (entry) => {
  entry.sourceUnsubscribe?.();
  entry.childUnsubscribes.forEach((unsubscribe) => unsubscribe());
  entry.sourceUnsubscribe = undefined;
  entry.childUnsubscribes = [];
  entry.childrenStarted = false;
  entry.reactions = [];
  entry.comments = [];
  entry.viewerReaction = undefined;
  entry.truncated = { reactions: false, comments: false };
  entry.ready = { reactions: false, comments: false, viewerReaction: false };
  entry.unavailable = false;
  entry.parentDoc = undefined;
};

const startInteractionChildren = (entry) => {
  if (entry.childrenStarted) return;
  entry.childrenStarted = true;
  const callbackIsCurrent = () => interactionSubscriptions.get(entry.parent.path) === entry
    && entry.generation === interactionGeneration
    && sessionGeneration.isCurrent(entry.session, entry.uid);
  for (const kind of ["reactions", "comments"]) {
    entry.childUnsubscribes.push(onSnapshot(
      query(
        collection(db, entry.parent.collection, entry.parent.id, kind),
        limit(MAX_INTERACTION_ITEMS_PER_PARENT)
      ),
      (snapshot) => {
        if (!callbackIsCurrent()) return;
        entry[kind] = snapshot.docs;
        entry.truncated[kind] = snapshot.size === MAX_INTERACTION_ITEMS_PER_PARENT;
        entry.ready[kind] = true;
        queueInteractionRender();
      },
      () => {
        if (!callbackIsCurrent()) return;
        entry[kind] = [];
        entry.truncated[kind] = false;
        entry.ready[kind] = false;
        entry.unavailable = true;
        queueInteractionRender();
        setStatus(`Could not load ${kind}.`, true);
      }
    ));
  }
  entry.childUnsubscribes.push(onSnapshot(
    doc(db, entry.parent.collection, entry.parent.id, "reactions", entry.uid),
    (snapshot) => {
      if (!callbackIsCurrent()) return;
      entry.viewerReaction = snapshot.exists() ? snapshot : undefined;
      entry.ready.viewerReaction = true;
      queueInteractionRender();
    },
    () => {
      if (!callbackIsCurrent()) return;
      entry.viewerReaction = undefined;
      entry.ready.viewerReaction = false;
      entry.unavailable = true;
      queueInteractionRender();
      setStatus("Could not load your reaction.", true);
    }
  ));
};

const syncInteractionListeners = () => {
  if (!viewerBlocks.ready) {
    clearInteractionListeners();
    queueInteractionRender();
    return;
  }
  const posts = visibleTimelinePosts().sort(compareNewestFirst);
  const visibleParents = new Map(posts.map((post) => [post.ref.path, post]));
  const desired = new Map(timelineInteractionPlan(posts, MAX_INTERACTION_PARENTS)
    .map((parent) => [parent.path, parent]));
  posts.forEach((post) => {
    const parent = interactionParentForPost(post);
    if (manuallyLoadedInteractionPaths.has(parent.path)) desired.set(parent.path, parent);
  });
  interactionSubscriptions.forEach((entry, path) => {
    if (desired.has(path)) return;
    stopInteractionEntry(entry);
    interactionSubscriptions.delete(path);
  });
  desired.forEach((parent, path) => {
    const existing = interactionSubscriptions.get(path);
    const visibleParent = visibleParents.get(path);
    if (existing) {
      if (visibleParent && !existing.childrenStarted) {
        existing.sourceUnsubscribe?.();
        existing.sourceUnsubscribe = undefined;
        existing.parentDoc = visibleParent;
        startInteractionChildren(existing);
      }
      return;
    }
    const entry = {
      parent,
      parentDoc: visibleParent,
      reactions: [],
      comments: [],
      viewerReaction: undefined,
      truncated: { reactions: false, comments: false },
      ready: { reactions: false, comments: false, viewerReaction: false },
      unavailable: false,
      sourceUnsubscribe: undefined,
      childUnsubscribes: [],
      childrenStarted: false,
      generation: interactionGeneration,
      session: activeTimelineSession,
      uid: currentUser.uid
    };
    interactionSubscriptions.set(path, entry);
    if (visibleParent) {
      startInteractionChildren(entry);
      return;
    }
    entry.sourceUnsubscribe = onSnapshot(
      doc(db, parent.collection, parent.id),
      (snapshot) => {
        if (interactionSubscriptions.get(path) !== entry
          || entry.generation !== interactionGeneration
          || !sessionGeneration.isCurrent(entry.session, entry.uid)) return;
        if (!snapshot.exists() || !isBlockedPost(snapshot, viewerBlocks)) {
          entry.childUnsubscribes.forEach((unsubscribe) => unsubscribe());
          entry.childUnsubscribes = [];
          entry.childrenStarted = false;
          entry.parentDoc = undefined;
          entry.reactions = [];
          entry.comments = [];
          entry.viewerReaction = undefined;
          entry.truncated = { reactions: false, comments: false };
          entry.ready = { reactions: false, comments: false, viewerReaction: false };
          entry.unavailable = true;
          queueInteractionRender();
          return;
        }
        entry.parentDoc = snapshot;
        entry.unavailable = false;
        startInteractionChildren(entry);
        queueInteractionRender();
      },
      () => {
        if (interactionSubscriptions.get(path) !== entry
          || entry.generation !== interactionGeneration
          || !sessionGeneration.isCurrent(entry.session, entry.uid)) return;
        entry.parentDoc = undefined;
        entry.reactions = [];
        entry.comments = [];
        entry.viewerReaction = undefined;
        entry.truncated = { reactions: false, comments: false };
        entry.ready = { reactions: false, comments: false, viewerReaction: false };
        entry.unavailable = true;
        queueInteractionRender();
      }
    );
  });
  queueInteractionRender();
};

const refreshViewerBlocks = () => {
  viewerBlocks = blockTracker.current();
  syncInteractionListeners();
  syncPollVoteListeners();
  renderFeed();
  renderSearchResults();
  renderNotifications();
};

const clearPollVoteListeners = () => {
  pollVoteGeneration += 1;
  pollVoteListeners.forEach((unsubscribe) => unsubscribe());
  pollVoteListeners = [];
  pollVotes = [];
};

const visiblePollTargets = () => {
  const targets = new Map();
  for (const post of visibleTimelinePosts().filter((entry) => entry.data().category === "Poll")) {
    const parent = interactionParentForPost(post);
    if (["posts", "communityPosts"].includes(parent.collection)) targets.set(parent.path, parent);
  }
  return [...targets.values()];
};

const syncPollVoteListeners = () => {
  clearPollVoteListeners();
  const generation = pollVoteGeneration;
  const votesByPoll = new Map();
  visiblePollTargets().forEach((target) => {
    pollVoteListeners.push(onSnapshot(
      query(
        collection(db, "communityVotes"),
        where("postCollection", "==", target.collection),
        where("postId", "==", target.id)
      ),
      (snapshot) => {
        if (generation !== pollVoteGeneration) return;
        votesByPoll.set(target.path, snapshot.docs);
        pollVotes = [...votesByPoll.values()].flat();
        renderFeed();
      },
      () => setStatus("Could not load poll votes.", true)
    ));
  });
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

const stopTimelineResources = () => {
  listeners.splice(0).forEach((unsubscribe) => unsubscribe());
  clearNotificationExpiryTimer();
  clearNotificationExpiryTimer = () => {};
  moderationClient?.destroy();
  moderationClient = null;
  clearPollVoteListeners();
  clearInteractionListeners();
  postDocs = [];
  communityPostDocs = [];
  follows = [];
  users = [];
  notificationReads = [];
  messageRequests = [];
  roomMessages = [];
  roomMemberships = [];
  reveals = [];
  blockTracker.reset(currentUser?.uid);
  viewerBlocks = blockTracker.current();
  profileUsername = "";
  seenNotificationIds = new Set();
  renderSpotifySong("");
  document.getElementById("display-name").textContent = "Loading profile…";
  document.getElementById("user-handle").textContent = "";
  document.getElementById("my-profile-link").removeAttribute("href");
  document.getElementById("admin-link").hidden = true;
  renderFeed();
  renderSearchResults();
  renderNotifications();
};
const invalidateTimelineSession = () => {
  sessionGeneration.invalidate();
  stopTimelineResources();
};

onAuthStateChanged(auth, async (user) => {
  activeTimelineSession = sessionGeneration.begin(user?.uid);
  const session = activeTimelineSession;
  const sessionIsCurrent = () => sessionGeneration.isCurrent(session, user?.uid);
  stopTimelineResources();
  if (!user) {
    currentUser = undefined;
    stopTimelineResources();
    await exitAfterAuthLoss({
      redirect: () => window.location.replace("index.html")
    });
    return;
  }

  currentUser = user;
  blockTracker = createViewerBlockTracker(user.uid);
  viewerBlocks = blockTracker.current();
  moderationClient = createModerationClient({
    db,
    firestore: { deleteDoc, doc, getDoc, setDoc, writeBatch },
    currentUid: user.uid,
    timestamp: serverTimestamp
  });
  seenNotificationIds = readSeenNotificationIds({ getStorage: () => window.localStorage, uid: user.uid });
  const profileRef = doc(db, "users", user.uid);
  let profile = await getDoc(profileRef);
  if (!sessionIsCurrent()) return;
  if (profile.exists() && profile.data().banned === true) {
    setStatus("This account has been banned.", true);
    await exitAuthenticatedSession({
      user,
      stopListeners: invalidateTimelineSession,
      redirect: () => window.location.replace("index.html")
    });
    return;
  }
  if (!profile.exists() || !validProfile(profile.data(), user.uid)) {
    profileUsername = await ensureUserProfile(user, db);
    profile = await getDoc(profileRef);
    if (!sessionIsCurrent()) return;
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
  const premiumAccess = await getDoc(doc(db, "premiumAccess", user.uid));
  if (!sessionIsCurrent()) return;
  document.getElementById("membership-badge").textContent = premiumAccess.exists()
    ? premiumLabel(premiumAccess.data()) : "Member";
  document.getElementById("my-profile-link").href =
    `profile.html?uid=${encodeURIComponent(user.uid)}`;
  document.getElementById("admin-link").hidden =
    !["i_love_you_h", "cybercapone"].includes(profileUsername.toLowerCase());
  const statsRef = doc(db, "system", "accountStats");
  const statsSnapshot = await getDoc(statsRef);
  if (!sessionIsCurrent()) return;
  if (!statsSnapshot.exists()) {
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
  listeners.push(clearPollVoteListeners);
  listeners.push(clearInteractionListeners);
  const listenForSession = (reference, next, failed) => onSnapshot(
    reference,
    (snapshot) => { if (sessionIsCurrent()) next(snapshot); },
    (error) => { if (sessionIsCurrent()) failed?.(error); }
  );

  listeners.push(listenForSession(
    query(collection(db, "posts"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), limit(TIMELINE_POST_LIMIT)),
    (snapshot) => {
      syncReportedHolds("posts", snapshot.docs);
      postDocs = snapshot.docs;
      syncPollVoteListeners();
      syncInteractionListeners();
      renderFeed();
      renderSearchResults();
    },
    () => setStatus("Could not load posts.", true)
  ));

  listeners.push(listenForSession(
    query(collection(db, "communityPosts"), where("moderationState", "==", "visible"), orderBy("createdAt", "desc"), limit(TIMELINE_POST_LIMIT)),
    (snapshot) => {
      syncReportedHolds("communityPosts", snapshot.docs);
      communityPostDocs = snapshot.docs;
      syncPollVoteListeners();
      syncInteractionListeners();
      renderFeed();
    },
    () => setStatus("Could not load earlier community posts.", true)
  ));

  listeners.push(listenForSession(
    collection(db, "users"),
    (snapshot) => {
      users = snapshot.docs;
      renderNotifications();
      renderSearchResults();
    },
    () => setStatus("Could not load notification names.", true)
  ));

  listeners.push(listenForSession(
    query(collection(db, "notificationReads"), where("uid", "==", user.uid)),
    (snapshot) => {
      notificationReads = snapshot.docs;
      renderNotifications();
    },
    () => setStatus("Could not load cleared notifications.", true)
  ));

  listeners.push(listenForSession(
    collection(db, "follows"),
    (snapshot) => {
      follows = snapshot.docs;
      renderFeed();
    },
    () => setStatus("Could not load follower counts.", true)
  ));

  listeners.push(listenForSession(
    query(collection(db, "messageRequests"), where("toId", "==", user.uid)),
    (snapshot) => {
      messageRequests = snapshot.docs;
      renderNotifications();
    },
    () => setStatus("Could not load message-request notifications.", true)
  ));

  listeners.push(listenForSession(
    query(collection(db, "roomMembers"), where("uid", "==", user.uid)),
    (snapshot) => {
      roomMemberships = snapshot.docs;
      renderNotifications();
    },
    () => setStatus("Could not load room memberships.", true)
  ));

  listeners.push(listenForSession(
    query(collection(db, "blocks"), where("blockerUid", "==", user.uid)),
    (snapshot) => {
      viewerBlocks = blockTracker.update("outgoing", snapshot.docs);
      refreshViewerBlocks();
    },
    () => {
      viewerBlocks = blockTracker.fail("outgoing");
      refreshViewerBlocks();
      setStatus("Could not load block preferences.", true);
    }
  ));

  listeners.push(listenForSession(
    query(collection(db, "blocks"), where("blockedUid", "==", user.uid)),
    (snapshot) => {
      viewerBlocks = blockTracker.update("incoming", snapshot.docs);
      refreshViewerBlocks();
    },
    () => {
      viewerBlocks = blockTracker.fail("incoming");
      refreshViewerBlocks();
      setStatus("Could not load block preferences.", true);
    }
  ));

  listeners.push(listenForSession(query(collection(db, "roomMessages"), where("moderationState", "==", "visible")), (snapshot) => {
    roomMessages = snapshot.docs;
    renderNotifications();
  }));

  listeners.push(listenForSession(
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
  const category = postCategory.value;
  const options = [...document.querySelectorAll(".poll-option")]
    .map((input) => input.value.trim())
    .filter(Boolean);
  if (!currentUser || postContent.length > 500) return;
  if (category === "Poll" && options.length < 2) {
    setStatus("Add at least two poll choices.", true);
    return;
  }
  if (category !== "Poll" && !postContent && !pendingPostImage) return;
  const expiryHours = Number(postExpiry.value);

  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await addDoc(collection(db, "posts"), buildOriginalPost({
      authorId: currentUser.uid,
      username: profileUsername,
      content: postContent || "Poll",
      imageData: pendingPostImage,
      category,
      options: category === "Poll" ? options : [],
      expiresAt: expiryHours ? Timestamp.fromMillis(Date.now() + expiryHours * 3600000) : null,
      createdAt: serverTimestamp()
    }));
    content.value = "";
    pendingPostImage = "";
    postImageInput.value = "";
    postImagePreviewWrap.hidden = true;
    setPhotoSelected(false);
    postCategory.value = "Post";
    postExpiry.value = "0";
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
    stopListeners: invalidateTimelineSession,
    redirect: () => window.location.replace("index.html")
  });
});

addEventListener("pagehide", (event) => {
  clearNotificationExpiryTimer();
  if (!event.persisted) {
    sessionGeneration.invalidate();
    stopTimelineResources();
  }
});
addEventListener("pageshow", (event) => { if (event.persisted) renderNotifications(); });
