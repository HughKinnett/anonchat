import { auth, db } from "./firebase-config.js";
import { ensureUserProfile } from "./legacy-profile.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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
        ? `hearted your post: “${post.content.slice(0, 80)}${post.content.length > 80 ? "…" : ""}”`
        : `gave Fuck You to your post: “${post.content.slice(0, 80)}${post.content.length > 80 ? "…" : ""}”`
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

const addReaction = async (postId, type) => {
  await addDoc(collection(db, "posts", postId, "reactions"), {
    uid: currentUser.uid,
    type,
    createdAt: serverTimestamp()
  });
};

const reactionButton = (postId, type, emoji, reactionDocs) => {
  const count = reactionDocs.filter((reaction) => reaction.data().type === type).length;
  const button = document.createElement("button");
  button.className = "reaction-button";
  button.type = "button";
  button.textContent = type === "heart" ? `${emoji} Heart · ${count}` : `${emoji} Fuck You · ${count}`;
  button.title = type === "heart" ? "Heart this post" : "Give this post the middle finger";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await addReaction(postId, type);
    } catch {
      setStatus("Could not save your reaction.", true);
    } finally {
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
  const time = document.createElement("small");
  time.textContent = post.createdAt?.toDate
    ? post.createdAt.toDate().toLocaleString()
    : "Posting…";

  const reactionDocs = postReactions(sourceId);
  const reactionsBar = document.createElement("div");
  reactionsBar.className = "reactions";
  reactionsBar.append(
    reactionButton(sourceId, "heart", "❤️", reactionDocs),
    reactionButton(sourceId, "middle_finger", "🖕", reactionDocs)
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
  attachMentionAutocomplete(commentInput);
  const commentSubmit = document.createElement("button");
  commentSubmit.type = "submit";
  commentSubmit.textContent = "Comment";
  commentForm.append(commentInput, commentSubmit);
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

  item.append(authorRow, text, time, reactionsBar, commentsSection, actions);
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
  try {
    seenNotificationIds = new Set(JSON.parse(
      localStorage.getItem(`anonchat-seen-notifications-${user.uid}`) || "[]"
    ));
  } catch {
    seenNotificationIds = new Set();
  }
  const profileRef = doc(db, "users", user.uid);
  let profile = await getDoc(profileRef);
  if (!profile.exists() || !validProfile(profile.data(), user.uid)) {
    profileUsername = await ensureUserProfile(user, db);
    profile = await getDoc(profileRef);
  } else {
    profileUsername = profile.data().username;
  }
  document.getElementById("display-name").textContent = profileUsername || "AnonChat user";
  document.getElementById("user-handle").textContent = profileUsername ? `@${profileUsername}` : "";
  document.getElementById("my-profile-link").href =
    `profile.html?uid=${encodeURIComponent(user.uid)}`;

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
  if (!currentUser || !postContent || postContent.length > 500) return;

  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await addDoc(collection(db, "posts"), {
      type: "original",
      authorId: currentUser.uid,
      username: profileUsername,
      content: postContent,
      createdAt: serverTimestamp()
    });
    content.value = "";
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
