import { auth, db } from "./firebase-config.js";
import { ensureUserProfile } from "./legacy-profile.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { blockId, canShowActorContent, postIsVisible } from "./moderation-policy.mjs";
import { postChildBelongsTo, postImagePresentation, postInteractionTarget } from "./post-report-ui-policy.mjs";
import { createBlockPairLoadGate, loadBlockPairs, profileBlockViewState } from "./block-integration.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const targetUserId = new URLSearchParams(window.location.search).get("uid");
const feed = document.getElementById("profile-feed");
const status = document.getElementById("profile-status");
const followButton = document.getElementById("profile-follow-button");
const blockButton = document.getElementById("profile-block-button");
let currentUser;
let currentProfileUsername;
let comments = [];
let follows = [];
let targetProfile;
let targetPosts = [];
let targetCommunityPosts = [];
let users = [];
let blockPairs = new Set();
let profileHiddenByBlock = false;
let blockPairsInitialized = false;
let blockPairsError;
const blockPairLoadGate = createBlockPairLoadGate();
const blockPairsReady = blockPairLoadGate.ready;
const profileSpotifyCard = document.getElementById("profile-spotify-card");
const profileSpotifyPlayer = document.getElementById("profile-spotify-player");

const spotifyTrackId = (value) => {
  try {
    const url = new URL(String(value || "").trim());
    if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return "";
    return url.pathname.match(/\/track\/([A-Za-z0-9]{22})(?:\/|$)/)?.[1] || "";
  } catch {
    return "";
  }
};

const renderProfileSpotifySong = (url) => {
  const id = spotifyTrackId(url);
  profileSpotifyPlayer.replaceChildren();
  profileSpotifyCard.hidden = !id;
  if (!id) return;
  const frame = document.createElement("iframe");
  frame.src = `https://open.spotify.com/embed/track/${id}?utm_source=generator&theme=0`;
  frame.title = `@${targetProfile.username}'s Spotify profile song`;
  frame.loading = "lazy";
  frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";
  const open = document.createElement("a");
  open.className = "spotify-open-link";
  open.href = `https://open.spotify.com/track/${id}`;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "Open this song in Spotify";
  profileSpotifyPlayer.append(frame, open);
};

const validProfile = (profile, userId) =>
  profile?.uid === userId &&
  typeof profile.username === "string" &&
  /^[A-Za-z0-9_]{3,30}$/.test(profile.username);

const actorIsVisible = (uid) => uid === currentUser?.uid || (blockPairsInitialized && canShowActorContent(uid, blockPairs));
const profileViewState = () => profileBlockViewState({
  initialized: blockPairsInitialized,
  error: blockPairsError,
  currentUid: currentUser?.uid,
  targetUid: targetUserId,
  pairs: blockPairs
});
const targetIsBlocked = () => !profileViewState().contentVisible;
const postIsVisibleByBlock = (post) => {
  const data = post.data();
  return !targetIsBlocked()
    && actorIsVisible(data.authorId)
    && (data.type !== "repost" || actorIsVisible(data.originalAuthorId));
};

const hideBlockedProfile = () => {
  const view = profileViewState();
  profileHiddenByBlock = true;
  document.querySelector(".view-profile-banner").hidden = true;
  profileSpotifyCard.hidden = true;
  feed.replaceChildren();
  document.getElementById("profile-post-count").textContent = "";
  document.getElementById("profile-name").textContent = "Unavailable profile";
  document.getElementById("profile-handle").textContent = "";
  setStatus(view.status, Boolean(blockPairsError));
};

const appendLinkedText = (container, value) => {
  String(value || "").split(/(@[A-Za-z0-9_]{3,30})/g).forEach((part) => {
    if (!part.startsWith("@")) {
      container.append(document.createTextNode(part));
      return;
    }
    const handle = part.slice(1).toLowerCase();
    const profile = users.find((entry) => actorIsVisible(entry.id) && entry.data().username?.toLowerCase() === handle);
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
      .filter((entry) => actorIsVisible(entry.id) && entry.data().username?.toLowerCase().startsWith(queryText))
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
  });
  input.addEventListener("blur", () => window.setTimeout(close, 120));
};

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#fca5a5" : "inherit";
};

const followerCount = () =>
  follows.filter((follow) => follow.data().followingId === targetUserId).length;

const followingCount = () =>
  follows.filter((follow) => follow.data().followerId === targetUserId).length;

const isFollowing = () =>
  follows.some((follow) =>
    follow.data().followerId === currentUser.uid && follow.data().followingId === targetUserId
  );

const renderFollowControl = () => {
  const count = followerCount();
  const following = followingCount();
  const followersLink = document.getElementById("profile-followers");
  const followingLink = document.getElementById("profile-following");
  followersLink.textContent = `${count} ${count === 1 ? "follower" : "followers"}`;
  followingLink.textContent = `${following} following`;
  followersLink.href = `connections.html?uid=${encodeURIComponent(targetUserId)}#followers`;
  followingLink.href = `connections.html?uid=${encodeURIComponent(targetUserId)}#following`;

  if (!targetProfile || currentUser.uid === targetUserId || targetIsBlocked()) {
    followButton.hidden = true;
    return;
  }

  followButton.hidden = false;
  followButton.setAttribute("aria-pressed", String(isFollowing()));
  followButton.textContent = isFollowing() ? "Following" : "Follow";
  followButton.disabled = false;
};

const renderBlockControl = () => {
  if (!currentUser || !targetProfile) {
    blockButton.hidden = true;
    return;
  }
  const control = profileViewState().control;
  blockButton.hidden = !control.visible;
  if (!control.visible) return;
  blockButton.textContent = control.label;
  blockButton.setAttribute("aria-pressed", String(control.ownBlock));
  blockButton.disabled = false;
};

const postComments = (collectionName, postId) => comments
  .filter((comment) => postChildBelongsTo(
    { id: postId, collectionName },
    {
      postId: comment.ref.parent.parent?.id,
      collectionName: comment.ref.parent.parent?.parent.id
    }
  ) && actorIsVisible(comment.data().uid))
  .sort((a, b) =>
    (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0)
  );

const renderPosts = () => {
  if (targetIsBlocked()) return;
  const sorted = [...targetPosts, ...targetCommunityPosts]
    .filter(postIsVisibleByBlock)
    .filter((post) => postIsVisible(post.data(), Date.now()))
    .sort((a, b) => {
    const aTime = a.data().createdAt?.toMillis?.() || 0;
    const bTime = b.data().createdAt?.toMillis?.() || 0;
    return bTime - aTime;
  });

  feed.replaceChildren(...sorted.map((postDoc) => {
    const post = postDoc.data();
    const item = document.createElement("li");
    item.className = "feed-item";

    if (post.type === "repost") {
      const label = document.createElement("p");
      label.className = "repost-label";
      label.textContent = `↗ @${targetProfile.username} shared this`;
      item.append(label);

      const originalAuthor = document.createElement("a");
      originalAuthor.className = "author-link";
      originalAuthor.href = `profile.html?uid=${encodeURIComponent(post.originalAuthorId)}`;
      originalAuthor.textContent = `@${post.originalUsername}`;
      item.append(originalAuthor);
    }

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
    const sourceCollection = postDoc.ref.parent.id === "communityPosts" ? "communityPosts" : "posts";
    const interactionPostId = postInteractionTarget({ ...post, id: postDoc.id });
    const commentDocs = postComments(sourceCollection, interactionPostId);
    const commentsSection = document.createElement("details");
    commentsSection.className = "comments-section";
    const summary = document.createElement("summary");
    summary.textContent = `Comments · ${commentDocs.length}`;
    const list = document.createElement("ul");
    list.className = "comments-list";
    commentDocs.forEach((commentDoc) => {
      const comment = commentDoc.data();
      const commentItem = document.createElement("li");
      commentItem.className = "comment-item";
      const author = document.createElement("a");
      author.className = "comment-author";
      author.href = `profile.html?uid=${encodeURIComponent(comment.uid)}`;
      author.textContent = `@${comment.username || "anonymous"}`;
      const body = document.createElement("p");
      appendLinkedText(body, comment.text);
      const commentTime = document.createElement("time");
      commentTime.textContent = comment.createdAt?.toDate
        ? comment.createdAt.toDate().toLocaleString()
        : "Posting…";
      const actions = document.createElement("div");
      actions.className = "comment-actions";
      const reply = document.createElement("button");
      reply.type = "button";
      reply.textContent = "Reply";
      reply.addEventListener("click", () => {
        input.value = `@${comment.username || "anonymous"} `;
        commentsSection.open = true;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
      actions.append(reply);
      if (comment.uid === currentUser.uid || post.authorId === currentUser.uid) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "delete-comment-button";
        remove.textContent = "Delete";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await deleteDoc(commentDoc.ref);
          } catch {
            setStatus("Could not delete that comment.", true);
            remove.disabled = false;
          }
        });
        actions.append(remove);
      }
      commentItem.append(author, body, commentTime, actions);
      list.append(commentItem);
    });

    const form = document.createElement("form");
    form.className = "comment-form";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 280;
    input.required = true;
    input.placeholder = "Comment or tag @username…";
    input.setAttribute("aria-label", "Write a comment");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Comment";
    form.append(input, submit);
    attachMentionAutocomplete(input);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const commentText = input.value.trim();
      if (!commentText || targetIsBlocked()) return;
      submit.disabled = true;
      try {
        await addDoc(collection(db, sourceCollection, interactionPostId, "comments"), {
          uid: currentUser.uid,
          username: currentProfileUsername,
          text: commentText,
          createdAt: serverTimestamp()
        });
        input.value = "";
        commentsSection.open = true;
      } catch {
        setStatus("Could not post your comment.", true);
      } finally {
        submit.disabled = false;
      }
    });
    if (!targetIsBlocked()) commentsSection.append(summary, list, form);

    item.append(text);
    if (postImage) item.append(postImage);
    item.append(time, commentsSection);
    return item;
  }));

  document.getElementById("profile-post-count").textContent =
    `${sorted.length} ${sorted.length === 1 ? "post" : "posts"}`;
  setStatus(sorted.length ? "" : "This user has not posted or shared anything yet.");
};

followButton.addEventListener("click", async () => {
  followButton.disabled = true;
  const followRef = doc(db, "follows", `${currentUser.uid}_${targetUserId}`);
  try {
    if (isFollowing()) {
      await deleteDoc(followRef);
    } else {
      await setDoc(followRef, {
        followerId: currentUser.uid,
        followingId: targetUserId,
        createdAt: serverTimestamp()
      });
    }
  } catch {
    setStatus("Could not update that follow.", true);
    followButton.disabled = false;
  }
});

blockButton.addEventListener("click", async () => {
  const ownBlockId = blockId(currentUser.uid, targetUserId);
  blockButton.disabled = true;
  try {
    if (blockPairs.has(ownBlockId)) {
      await deleteDoc(doc(db, "blocks", ownBlockId));
      if (!blockPairsInitialized) blockPairs.delete(ownBlockId);
    } else {
      await setDoc(doc(db, "blocks", ownBlockId), {
        blockerId: currentUser.uid,
        blockedId: targetUserId,
        createdAt: serverTimestamp()
      });
      if (!blockPairsInitialized) blockPairs.add(ownBlockId);
    }
    if (!blockPairsInitialized) renderBlockControl();
  } catch {
    setStatus("Could not update this block.", true);
    blockButton.disabled = false;
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    const destination = targetUserId
      ? `index.html?next=${encodeURIComponent(`profile.html?uid=${targetUserId}`)}`
      : "index.html";
    await exitAfterAuthLoss({ redirect: () => window.location.replace(destination) });
    return;
  }

  if (!targetUserId) {
    window.location.replace("timeline.html");
    return;
  }

  currentUser = user;
  loadBlockPairs({ db, uid: user.uid, onChange: (pairs) => {
    blockPairs = pairs;
    if (!blockPairsInitialized) {
      blockPairsInitialized = true;
      blockPairLoadGate.succeed();
    }
    if (targetProfile && targetIsBlocked()) {
      hideBlockedProfile();
    } else if (profileHiddenByBlock) {
      window.location.reload();
      return;
    }
    renderBlockControl();
    renderFollowControl();
    renderPosts();
  }, onError: (error) => {
    blockPairsError = error;
    blockPairLoadGate.fail(error);
    setStatus("Could not load block settings.", true);
  } }).then((unsubscribe) => {
    if (typeof unsubscribe === "function") window.addEventListener("pagehide", unsubscribe, { once: true });
  }).catch((error) => {
    blockPairsError = error;
    blockPairLoadGate.fail(error);
    setStatus("Could not load block settings.", true);
  });
  const currentProfileRef = doc(db, "users", user.uid);
  let currentProfileSnapshot = await getDoc(currentProfileRef);
  if (currentProfileSnapshot.exists() && currentProfileSnapshot.data().banned === true) {
    await exitAuthenticatedSession({
      user,
      redirect: () => window.location.replace("index.html")
    });
    return;
  }
  if (!currentProfileSnapshot.exists() || !validProfile(currentProfileSnapshot.data(), user.uid)) {
    currentProfileUsername = await ensureUserProfile(user, db);
    currentProfileSnapshot = await getDoc(currentProfileRef);
  } else {
    currentProfileUsername = currentProfileSnapshot.data().username;
  }
  void recordPageActivity({
    surface: "profile",
    profile: currentProfileSnapshot.data(),
    user,
    db,
    firestore: { doc, updateDoc, serverTimestamp }
  });

  const targetProfileRef = doc(db, "users", targetUserId);
  let profileSnapshot = await getDoc(targetProfileRef);
  if (
    targetUserId === user.uid &&
    (!profileSnapshot.exists() || !validProfile(profileSnapshot.data(), user.uid))
  ) {
    await ensureUserProfile(user, db);
    profileSnapshot = await getDoc(targetProfileRef);
  }
  if (!profileSnapshot.exists()) {
    document.getElementById("profile-name").textContent = "Profile not found";
    setStatus("This anonymous profile does not exist.", true);
    return;
  }

  targetProfile = profileSnapshot.data();
  await blockPairsReady;
  if (targetIsBlocked()) {
    hideBlockedProfile();
    renderBlockControl();
    return;
  }
  if (targetProfile.banned === true && currentUser.uid !== targetUserId) {
    document.getElementById("profile-name").textContent = "Unavailable profile";
    setStatus("This account is banned.", true);
    return;
  }
  renderProfileSpotifySong(targetProfile.spotifyTrackUrl || "");
  document.title = `@${targetProfile.username} — AnonChat`;
  document.getElementById("profile-name").textContent = targetProfile.username;
  document.getElementById("profile-handle").textContent = `@${targetProfile.username}`;
  if (targetProfile.profileImage) {
    document.getElementById("view-profile-avatar").src = targetProfile.profileImage;
  }
  if (targetProfile.coverImage) {
    document.getElementById("view-profile-cover").src = targetProfile.coverImage;
  }
  const adminUsernames = ["i_love_you_h", "cybercapone"];
  const viewerIsAdmin = adminUsernames.includes(currentProfileUsername.toLowerCase());
  document.getElementById("profile-admin-link").hidden = !viewerIsAdmin;
  renderBlockControl();
  const viewDay = new Date().toISOString().slice(0, 10);
  setDoc(doc(db, "pageViews", viewDay), {
    date: viewDay,
    views: increment(1),
    updatedAt: serverTimestamp()
  }, { merge: true }).catch(() => {});

  onSnapshot(collection(db, "users"), (snapshot) => {
    users = snapshot.docs;
    renderPosts();
  }, () => setStatus("Could not load user tags.", true));

  onSnapshot(collectionGroup(db, "comments"), (snapshot) => {
    comments = snapshot.docs;
    renderPosts();
  }, () => setStatus("Could not load comments.", true));

  onSnapshot(collection(db, "follows"), (snapshot) => {
    follows = snapshot.docs;
    renderFollowControl();
  }, () => setStatus("Could not load follower information.", true));

  onSnapshot(
    query(
      collection(db, "posts"),
      where("authorId", "==", targetUserId),
      where("moderationStatus", "==", "active")
    ),
    (snapshot) => {
      targetPosts = snapshot.docs;
      renderPosts();
    },
    () => setStatus("Could not load this user's posts.", true)
  );

  onSnapshot(
    query(
      collection(db, "communityPosts"),
      where("authorId", "==", targetUserId),
      where("moderationStatus", "==", "active")
    ),
    (snapshot) => {
      targetCommunityPosts = snapshot.docs;
      renderPosts();
    },
    () => setStatus("Could not load this user's earlier posts.", true)
  );
});
