import { auth, db } from "./firebase-config.js";
import { ensureUserProfile } from "./legacy-profile.js";
import { onAuthStateChanged, signOut, updateProfile } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
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
  updateDoc,
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
const postImageInput = document.getElementById("post-image-upload");
const postImagePreviewWrap = document.getElementById("post-image-preview-wrap");
const postImagePreview = document.getElementById("post-image-preview");
const alertsButton = document.getElementById("enable-alerts");
const editUsernameButton = document.getElementById("edit-username");
let browserAlertIds = null;
const spotifyCard = document.querySelector(".spotify-profile-card");
const spotifyPlayerWrap = document.getElementById("spotify-player-wrap");
const spotifyForm = document.getElementById("spotify-song-form");
const spotifyInput = document.getElementById("spotify-song-url");
const spotifyToggle = document.getElementById("spotify-edit-toggle");
const spotifyRemove = document.getElementById("spotify-song-remove");
const spotifyStatus = document.getElementById("spotify-song-status");

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

const updateAlertsButton = () => {
  if (!alertsButton) return;
  if (!("Notification" in window)) {
    alertsButton.textContent = "Alerts unavailable";
    alertsButton.disabled = true;
    return;
  }
  alertsButton.textContent = Notification.permission === "granted" ? "Alerts on" : "Enable alerts";
};

alertsButton?.addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  const permission = await Notification.requestPermission();
  updateAlertsButton();
  if (permission === "granted" && currentUser) {
    browserAlertIds = new Set(currentNotificationIds);
    localStorage.setItem(
      `anonchat-browser-alerts-${currentUser.uid}`,
      JSON.stringify([...browserAlertIds])
    );
    setStatus("Phone alerts are on while AnonChat is open or running in the background.");
  } else if (permission !== "granted") {
    setStatus("Allow notifications in your browser settings to receive alerts.", true);
  }
});
updateAlertsButton();

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

const openPostFromSearch = (postId) => {
  searchInput.value = "";
  closeSearch();
  setFeedView(false);
  requestAnimationFrame(() => {
    const target = document.getElementById(`post-${postId}`);
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
    .filter((profile) => profile.data().username?.toLowerCase().includes(term))
    .slice(0, 5);
  const matchedPosts = postDocs
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

const renderNotifications = () => {
  if (!currentUser) return;
  const ownedPosts = new Map(
    postDocs
      .filter((post) => post.data().type !== "repost" && post.data().authorId === currentUser.uid)
      .map((post) => [post.id, post.data()])
  );
  const allPosts = new Map(postDocs.map((post) => [post.id, post.data()]));
  const usernames = new Map(users.map((profile) => [profile.id, profile.data().username]));
  const readIds = new Set(notificationReads.map((read) => read.data().reactionId));
  const notificationItems = [];

  reactions.forEach((reaction) => {
    const postId = reaction.ref.parent.parent?.id;
    const data = reaction.data();
    const post = ownedPosts.get(postId);
    if (!post || data.uid === currentUser.uid) return;
    notificationItems.push({
      id: reaction.id,
      postId,
      actorId: data.uid,
      createdAt: data.createdAt,
      message: data.type === "heart"
        ? `reacted ❤️ to your post: “${post.content.slice(0, 80)}${post.content.length > 80 ? "…" : ""}”`
        : data.type === "laugh"
          ? `reacted 😂 to your post: “${post.content.slice(0, 80)}${post.content.length > 80 ? "…" : ""}”`
          : data.type === "sad"
            ? `reacted 😢 to your post: “${post.content.slice(0, 80)}${post.content.length > 80 ? "…" : ""}”`
            : `reacted 🖕 to your post: “${post.content.slice(0, 80)}${post.content.length > 80 ? "…" : ""}”`
    });
  });

  comments.forEach((comment) => {
    const postId = comment.ref.parent.parent?.id;
    const data = comment.data();
    const post = allPosts.get(postId);
    if (!post || data.uid === currentUser.uid) return;
    if (ownedPosts.has(postId)) {
      notificationItems.push({
        id: `comment_${comment.id}`,
        postId,
        actorId: data.uid,
        createdAt: data.createdAt,
        message: `commented on your post “${post.content.slice(0, 55)}${post.content.length > 55 ? "…" : ""}”: “${data.text.slice(0, 70)}${data.text.length > 70 ? "…" : ""}”`
      });
    }
    if (mentionsCurrentUser(data.text)) {
      notificationItems.push({
        id: `comment_mention_${comment.id}`,
        postId,
        actorId: data.uid,
        createdAt: data.createdAt,
        message: `tagged you in a comment: “${data.text.slice(0, 90)}${data.text.length > 90 ? "…" : ""}”`
      });
    }
  });

  postDocs.forEach((postDoc) => {
    const post = postDoc.data();
    if (
      post.type === "repost" ||
      post.authorId === currentUser.uid ||
      !mentionsCurrentUser(post.content)
    ) return;
    notificationItems.push({
      id: `post_mention_${postDoc.id}`,
      postId: postDoc.id,
      actorId: post.authorId,
      createdAt: post.createdAt,
      message: `tagged you in a post: “${post.content.slice(0, 100)}${post.content.length > 100 ? "…" : ""}”`
    });
  });

  const items = notificationItems
    .filter((item) => !readIds.has(item.id))
    .sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
    );

  currentNotificationIds = items.map((item) => item.id);
  if ("Notification" in window && Notification.permission === "granted") {
    if (browserAlertIds === null) {
      browserAlertIds = new Set(currentNotificationIds);
    } else {
      items.filter((item) => !browserAlertIds.has(item.id)).forEach((notification) => {
        const actor = usernames.get(notification.actorId) || "Anonymous user";
        const alert = new Notification("AnonChat", {
          body: `@${actor} ${notification.message}`,
          icon: "Untitled.jpeg",
          tag: `anonchat-${notification.id}`
        });
        alert.onclick = () => {
          window.focus();
          setFeedView(false);
          requestAnimationFrame(() => {
            document.getElementById(`post-${notification.postId}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center"
            });
          });
          alert.close();
        };
      });
    }
    currentNotificationIds.forEach((id) => browserAlertIds.add(id));
    localStorage.setItem(
      `anonchat-browser-alerts-${currentUser.uid}`,
      JSON.stringify([...browserAlertIds])
    );
  }
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
    const actor = usernames.get(notification.actorId) || "Anonymous user";
    message.textContent = `@${actor} ${notification.message}`;
    const time = document.createElement("time");
    time.textContent = formatNotificationTime(notification.createdAt);
    open.append(message, time);
    open.addEventListener("click", async () => {
      open.disabled = true;
      try {
        await setDoc(doc(db, "notificationReads", `${currentUser.uid}_${notification.id}`), {
          uid: currentUser.uid,
          reactionId: notification.id,
          readAt: serverTimestamp()
        });
        notificationPanel.hidden = true;
        notificationButton.setAttribute("aria-expanded", "false");
        setFeedView(false);
        requestAnimationFrame(() => {
          const target = document.getElementById(`post-${notification.postId}`);
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
    empty.textContent = "No new reactions, comments, or tags.";
    notificationList.append(empty);
  }
};

notificationButton.addEventListener("click", () => {
  const opening = notificationPanel.hidden;
  notificationPanel.hidden = !opening;
  notificationButton.setAttribute("aria-expanded", String(opening));
  if (opening && currentUser) {
    currentNotificationIds.forEach((id) => seenNotificationIds.add(id));
    localStorage.setItem(
      `anonchat-seen-notifications-${currentUser.uid}`,
      JSON.stringify([...seenNotificationIds])
    );
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

const originalPostId = (postDoc) =>
  postDoc.data().type === "repost" ? postDoc.data().originalPostId : postDoc.id;

const postReactions = (postId) => reactions.filter((reaction) =>
  reaction.ref.parent.parent?.id === postId
);

const postComments = (postId) => comments
  .filter((comment) => comment.ref.parent.parent?.id === postId)
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

const toggleReaction = async (postId, type, currentType) => {
  const reactionRef = doc(db, "posts", postId, "reactions", currentUser.uid);
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

const reactionButton = (postId, type, emoji, reactionDocs) => {
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
      await toggleReaction(postId, type, currentType);
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

  await setDoc(repostRef, {
    type: "repost",
    authorId: currentUser.uid,
    username: profileUsername,
    originalPostId: sourceId,
    originalAuthorId: sourceAuthorId,
    originalUsername: sourceUsername,
    content: post.content,
    imageData: post.imageData || "",
    createdAt: serverTimestamp()
  });
};

const renderPost = (postDoc) => {
  const post = postDoc.data();
  const sourceId = originalPostId(postDoc);
  const item = document.createElement("li");
  item.className = "feed-item";
  item.id = `post-${postDoc.id}`;

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
  time.textContent = post.createdAt?.toDate
    ? post.createdAt.toDate().toLocaleString()
    : "Posting…";

  const reactionDocs = postReactions(sourceId);
  const reactionsBar = document.createElement("div");
  reactionsBar.className = "reactions";
  reactionsBar.append(
    reactionButton(sourceId, "heart", "❤️", reactionDocs),
    reactionButton(sourceId, "middle_finger", "🖕", reactionDocs),
    reactionButton(sourceId, "laugh", "😂", reactionDocs),
    reactionButton(sourceId, "sad", "😢", reactionDocs)
  );

  const commentDocs = postComments(sourceId);
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
    commentItem.append(commenter, commentText, commentTime);
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
      await addDoc(collection(db, "posts", sourceId, "comments"), {
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

  if ((post.type === "repost" ? post.originalAuthorId : post.authorId) !== currentUser.uid) {
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
    remove.textContent = post.type === "repost" ? "Remove from profile" : "Delete";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await deleteDoc(doc(db, "posts", postDoc.id));
      } catch {
        setStatus("Could not remove that post.", true);
        remove.disabled = false;
      }
    });
    actions.append(remove);
  }

  item.append(authorRow, text);
  if (postImage) item.append(postImage);
  item.append(time, reactionsBar, commentsSection, actions);
  return item;
};

const renderFeed = () => {
  const visiblePosts = showingProfile
    ? postDocs.filter((post) => post.data().authorId === currentUser.uid)
    : postDocs;

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
    window.location.replace("index.html");
    return;
  }

  currentUser = user;
  const storedAlertIds = localStorage.getItem(`anonchat-browser-alerts-${user.uid}`);
  browserAlertIds = storedAlertIds ? new Set(JSON.parse(storedAlertIds)) : null;
  updateAlertsButton();
  try {
    seenNotificationIds = new Set(JSON.parse(
      localStorage.getItem(`anonchat-seen-notifications-${user.uid}`) || "[]"
    ));
  } catch {
    seenNotificationIds = new Set();
  }
  const profileRef = doc(db, "users", user.uid);
  let profile = await getDoc(profileRef);
  if (profile.exists() && profile.data().banned === true) {
    setStatus("This account has been banned.", true);
    await signOut(auth);
    window.location.replace("index.html");
    return;
  }
  if (!profile.exists() || !validProfile(profile.data(), user.uid)) {
    profileUsername = await ensureUserProfile(user, db);
    profile = await getDoc(profileRef);
  } else {
    profileUsername = profile.data().username;
  }
  renderSpotifySong(profile.data().spotifyTrackUrl || "");
  document.getElementById("display-name").textContent = profileUsername || "AnonChat user";
  document.getElementById("user-handle").textContent = profileUsername ? `@${profileUsername}` : "";
  document.getElementById("my-profile-link").href =
    `profile.html?uid=${encodeURIComponent(user.uid)}`;
  document.getElementById("admin-link").hidden =
    !["i_love_you_h", "ownercybercapone"].includes(profileUsername.toLowerCase());
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
    query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100)),
    (snapshot) => {
      postDocs = snapshot.docs;
      renderFeed();
      renderSearchResults();
    },
    () => setStatus("Could not load posts.", true)
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
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const postContent = content.value.trim();
  if (!currentUser || (!postContent && !pendingPostImage) || postContent.length > 500) return;

  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await addDoc(collection(db, "posts"), {
      type: "original",
      authorId: currentUser.uid,
      username: profileUsername,
      content: postContent,
      imageData: pendingPostImage,
      createdAt: serverTimestamp()
    });
    content.value = "";
    pendingPostImage = "";
    postImageInput.value = "";
    postImagePreviewWrap.hidden = true;
  } catch {
    setStatus("Could not publish your post.", true);
  } finally {
    submit.disabled = false;
  }
});

document.getElementById("sign-out").addEventListener("click", async () => {
  listeners.forEach((unsubscribe) => unsubscribe());
  await signOut(auth);
  window.location.replace("index.html");
});
