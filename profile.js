import { auth, db } from "./firebase-config.js";
import { ensureUserProfile } from "./legacy-profile.js";
import { recordPageActivity } from "./activity-integration.mjs";
import { shouldRecordDailyPageView } from "./page-view-budget.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { createModerationClient } from "./moderation-client.mjs";
import { REPORT_BUTTON_CLASS, REPORT_REASONS } from "./moderation-policy.mjs";
import { compareNewestFirst } from "./content-ordering.mjs";
import { blockedProfileStatus, commentsForPost, interactionParentForPost } from "./profile-render-policy.mjs";
import { clearProfileProtectedMetadata } from "./protected-metadata-policy.mjs";
import { createViewerBlockTracker, didViewerBlock, isBlockedActor, isBlockedPost, visibleRecords } from "./viewer-block-policy.mjs";
import { createSessionGeneration } from "./session-generation-policy.mjs";
import { isDesignatedAdmin } from "./designated-admin-policy.mjs";
import { hasPremiumAccess, premiumLabel } from "./premium-policy.mjs";
import { applyPremiumAvatar, applyPremiumCover, applyPremiumTheme, resolvedPremiumSettings } from "./premium-theme.mjs";
import { applyFreeAvatar, applyFreeCover } from "./free-profile-theme.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getCountFromServer,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAt,
  endAt,
  updateDoc, writeBatch,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const targetUserId = new URLSearchParams(window.location.search).get("uid");
const feed = document.getElementById("profile-feed");
const status = document.getElementById("profile-status");
const followButton = document.getElementById("profile-follow-button");
const socialActions = document.getElementById("profile-social-actions");
const reportButton = document.getElementById("profile-report-button");
const blockButton = document.getElementById("profile-block-button");
let currentUser;
let currentProfileUsername;
let comments = [];
let follows = [];
let exactFollowerCount = null;
let exactFollowingCount = null;
let targetProfile;
let targetPremiumAccess;
let targetPremiumSettings;
let targetPosts = [];
let targetCommunityPosts = [];
let users = [];
let moderationClient;
let targetBlocked = false;
let targetBlockedByViewer = false;
let blockTracker = createViewerBlockTracker();
let viewerBlocks = blockTracker.current();
let profileContentStarted = false;
const commentListeners = new Map();
const reportStateLoads = new Set();
const reportStateWatches = new Map();
let profileContentListeners = [];
const sessionListeners = [];
const sessionGeneration = createSessionGeneration();
let activeProfileSession = 0;
const PROFILE_FEED_LIMIT = 30;
let postsRenderQueued = false;
const schedulePostsRender = () => {
  if (postsRenderQueued) return;
  postsRenderQueued = true;
  queueMicrotask(() => { postsRenderQueued = false; renderPosts(); });
};
const profileSpotifyCard = document.getElementById("profile-spotify-card");
const profileSpotifyPlayer = document.getElementById("profile-spotify-player");
const profilePlaylistCard = document.getElementById("profile-playlist-card");
const profilePlaylistPlayer = document.getElementById("profile-playlist-player");

const userReportTarget = () => ({ targetKind: "user", targetCollection: "users", targetId: targetUserId, reportedUserId: targetUserId });
const postReportTarget = (postDoc, post) => ({
  targetKind: postDoc.ref.parent.id === "communityPosts" ? "communityPost" : "post",
  targetCollection: postDoc.ref.parent.id,
  targetId: postDoc.id,
  reportedUserId: post.authorId
});
const reportTargetKey = (target) => `${target.targetKind}:${target.targetId}`;
const loadReportedState = (target, onLoaded) => {
  const key = reportTargetKey(target);
  if (!reportStateWatches.has(key) && moderationClient) reportStateWatches.set(key, moderationClient.watchReported(target, onLoaded));
  if (!moderationClient || moderationClient.cachedReported(target) !== undefined) return;
  if (reportStateLoads.has(key)) return;
  const client = moderationClient;
  reportStateLoads.add(key);
  client.hasReported(target).then(() => {
    if (client !== moderationClient) return;
    reportStateLoads.delete(key);
    onLoaded();
  }).catch(() => {
    if (client !== moderationClient) return;
    reportStateLoads.delete(key);
    setStatus("Could not verify whether this material was already reported.", true);
  });
};

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

const spotifyPlaylistId = (value) => {
  try { const url = new URL(String(value || "").trim()); if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return ""; return url.pathname.match(/^\/playlist\/([A-Za-z0-9]+)(?:\/|$)/)?.[1] || ""; } catch { return ""; }
};
const renderProfileSpotifyPlaylist = (url = "") => {
  const id = spotifyPlaylistId(url); profilePlaylistPlayer.replaceChildren(); profilePlaylistCard.hidden = !id;
  if (!id) return;
  const frame = document.createElement("iframe"); frame.src = `https://open.spotify.com/embed/playlist/${id}?utm_source=generator&theme=0`; frame.title = `@${targetProfile.username}'s Spotify playlist`; frame.loading = "lazy"; frame.allow = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"; profilePlaylistPlayer.append(frame);
};

const clearProtectedProfileMetadata = (message) => {
  clearProfileProtectedMetadata({ document, renderSpotify: renderProfileSpotifySong }, message);
};

const renderTargetProfileIdentity = () => {
  if (!targetProfile || !viewerBlocks.ready) return;
  const targetHasPremium = hasPremiumAccess(targetPremiumAccess);
  renderProfileSpotifySong(targetBlocked || targetHasPremium ? "" : targetProfile.spotifyTrackUrl || "");
  renderProfileSpotifyPlaylist(targetBlocked || !targetHasPremium ? "" : targetProfile.spotifyPlaylistUrl || targetPremiumSettings?.spotifyPlaylistUrl || "");
  document.title = targetBlocked ? "Unavailable profile — AnonChat" : `@${targetProfile.username} — AnonChat`;
  document.getElementById("profile-name").textContent = targetBlocked ? "Unavailable profile" : targetProfile.username;
  document.getElementById("profile-handle").textContent = targetBlocked ? "" : `@${targetProfile.username}`;
  const membershipBadge = document.getElementById("profile-membership-badge");
  membershipBadge.hidden = targetBlocked;
  membershipBadge.textContent = targetPremiumAccess ? premiumLabel(targetPremiumAccess) : "Member";
  const profileAvatar = document.getElementById("view-profile-avatar");
  const profileCover = document.getElementById("view-profile-cover");
  profileAvatar.classList.remove("premium-avatar-choice", "premium-avatar-female", "free-avatar-choice", "has-custom-photo");
  profileCover.classList.remove("premium-cover-choice", "free-cover-choice", "has-custom-photo");
  profileAvatar.removeAttribute("style"); profileCover.removeAttribute("style");
  profileAvatar.hidden = false; profileCover.hidden = false;
  if (!targetBlocked && targetPremiumSettings) {
    applyPremiumTheme(document.body, targetPremiumSettings);
    applyPremiumTheme(document.querySelector(".profile-banner") || document.querySelector("main"), targetPremiumSettings);
  }
  const premiumAvatarApplied = !targetBlocked && targetPremiumSettings
    ? applyPremiumAvatar(profileAvatar, targetPremiumSettings.avatarId) : false;
  const freeAvatarApplied = !premiumAvatarApplied && !targetBlocked
    ? applyFreeAvatar(profileAvatar, targetProfile.freeAvatarId || "") : false;
  if (!premiumAvatarApplied && !freeAvatarApplied) {
    const avatarSource = !targetBlocked && targetProfile.profileImage
      ? targetProfile.profileImage : "anonchat-anonymous.png";
    profileAvatar.style.backgroundImage = `url(${JSON.stringify(avatarSource)})`;
    profileAvatar.classList.toggle("has-custom-photo", !targetBlocked && Boolean(targetProfile.profileImage));
  }
  const premiumCoverApplied = !targetBlocked && targetPremiumSettings
    ? applyPremiumCover(profileCover, targetPremiumSettings.coverId) : false;
  const freeCoverApplied = !premiumCoverApplied && !targetBlocked
    ? applyFreeCover(profileCover, targetProfile.freeCoverId || "") : false;
  if (premiumCoverApplied || freeCoverApplied) {
    profileCover.classList.remove("has-custom-photo");
  } else if (!targetBlocked && targetProfile.coverImage) {
    profileCover.style.backgroundImage = `url(${JSON.stringify(targetProfile.coverImage)})`;
    profileCover.classList.add("has-custom-photo");
  } else {
    profileCover.style.backgroundImage = "url('anonchat-anonymous.png')";
    profileCover.classList.remove("has-custom-photo");
  }
};

const validProfile = (profile, userId) =>
  profile?.uid === userId &&
  typeof profile.username === "string" &&
  /^[A-Za-z0-9_]{3,30}$/.test(profile.username);

const appendLinkedText = (container, value) => {
  String(value || "").split(/(@[A-Za-z0-9_]{3,30})/g).forEach((part) => {
    if (!part.startsWith("@")) {
      container.append(document.createTextNode(part));
      return;
    }
    const handle = part.slice(1).toLowerCase();
    const profile = visibleRecords(users, viewerBlocks, ["uid"])
      .find((entry) => entry.data().username?.toLowerCase() === handle);
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

  let searchTimer = 0;
  const render = async () => {
    const cursor = input.selectionStart ?? input.value.length;
    const match = input.value.slice(0, cursor).match(/@([A-Za-z0-9_]*)$/);
    if (!match) {
      close();
      return;
    }
    const queryText = match[1].toLowerCase();
    let matches = [];
    try {
      const usernameMatches = await getDocs(query(collection(db, "usernames"), orderBy(documentId()), startAt(queryText), endAt(`${queryText}\uf8ff`), limit(6)));
      const profiles = await Promise.all(usernameMatches.docs.map(entry => getDoc(doc(db, "users", entry.data().uid))));
      const latest = input.value.slice(0, input.selectionStart ?? input.value.length).match(/@([A-Za-z0-9_]*)$/)?.[1]?.toLowerCase();
      if (latest !== queryText) return;
      profiles.filter(entry => entry.exists()).forEach(entry => { if (!users.some(user => user.id === entry.id)) users.push(entry); });
      matches = visibleRecords(profiles.filter(entry => entry.exists()), viewerBlocks, ["uid"]);
    } catch { matches = []; }
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

  input.addEventListener("input", () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(render, 280); });
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

const followerCount = () => exactFollowerCount ?? visibleRecords(follows, viewerBlocks, ["followerId", "followingId"])
  .filter((follow) => follow.data().followingId === targetUserId).length;

const followingCount = () => exactFollowingCount ?? visibleRecords(follows, viewerBlocks, ["followerId", "followingId"])
  .filter((follow) => follow.data().followerId === targetUserId).length;

const isFollowing = () =>
  visibleRecords(follows, viewerBlocks, ["followerId", "followingId"]).some((follow) =>
    follow.data().followerId === currentUser.uid && follow.data().followingId === targetUserId
  );

const renderFollowControl = () => {
  if (!viewerBlocks.ready) {
    socialActions.hidden = true;
    return;
  }
  const count = followerCount();
  const following = followingCount();
  const followersLink = document.getElementById("profile-followers");
  const followingLink = document.getElementById("profile-following");
  followersLink.textContent = `${count} ${count === 1 ? "follower" : "followers"}`;
  followingLink.textContent = `${following} following`;
  followersLink.href = `connections.html?uid=${encodeURIComponent(targetUserId)}#followers`;
  followingLink.href = `connections.html?uid=${encodeURIComponent(targetUserId)}#following`;

  if (currentUser.uid === targetUserId) {
    socialActions.hidden = true;
    followButton.hidden = true;
    return;
  }

  socialActions.hidden = targetBlocked && !targetBlockedByViewer;
  if (targetBlocked && !targetBlockedByViewer) return;
  followButton.hidden = targetBlocked;
  followButton.setAttribute("aria-pressed", String(isFollowing()));
  followButton.textContent = isFollowing() ? "Following" : "Follow";
  followButton.disabled = false;
  blockButton.textContent = targetBlocked ? "Unblock user" : "Block user";
  blockButton.setAttribute("aria-pressed", String(targetBlocked));
  blockButton.disabled = false;
  const reported = moderationClient?.cachedReported(userReportTarget());
  reportButton.hidden = targetBlocked;
  reportButton.disabled = targetBlocked || reported !== false;
  reportButton.textContent = reported === true
    ? "Reported"
    : reported !== false
      ? "Checking report…"
      : "Report user";
  if (!targetBlocked) loadReportedState(userReportTarget(), renderFollowControl);
};

const commentParentPath = (comment) => comment.ref.parent.parent?.path || "";

const postComments = (postDoc) => commentsForPost(
  visibleRecords(comments, viewerBlocks, ["uid"]), postDoc
);

const removeReportedPostFromLocalState = (path) => {
  targetPosts = targetPosts.filter((entry) => entry.ref.path !== path);
  targetCommunityPosts = targetCommunityPosts.filter((entry) => entry.ref.path !== path);
  syncProfilePostResources([...targetPosts, ...targetCommunityPosts]);
  schedulePostsRender();
};

const syncProfilePostResources = (postDocs) => {
  const session = activeProfileSession;
  const uid = currentUser?.uid;
  const postPaths = new Set(postDocs.map((post) => interactionParentForPost(post).path));
  commentListeners.forEach((unsubscribe, path) => {
    if (postPaths.has(path)) return;
    unsubscribe();
    commentListeners.delete(path);
    comments = comments.filter((comment) => commentParentPath(comment) !== path);
  });
  const reportKeys = new Set(postDocs.filter((postDoc) => postDoc.data().authorId !== currentUser.uid)
    .map((postDoc) => reportTargetKey(postReportTarget(postDoc, postDoc.data()))));
  for (const [key, unsubscribe] of reportStateWatches) if (!key.startsWith("user:") && !reportKeys.has(key)) {
    unsubscribe(); reportStateWatches.delete(key); reportStateLoads.delete(key);
  }
  postDocs.forEach((postDoc) => {
    const parent = interactionParentForPost(postDoc);
    if (commentListeners.has(parent.path)) return;
    const unsubscribe = onSnapshot(
      query(collection(db, parent.collection, parent.id, "comments"), orderBy("createdAt", "desc"), limit(20)),
      (snapshot) => {
        if (!sessionGeneration.isCurrent(session, uid)) return;
        comments = [
          ...comments.filter((comment) => commentParentPath(comment) !== parent.path),
          ...snapshot.docs
        ];
        schedulePostsRender();
      },
      () => {
        if (sessionGeneration.isCurrent(session, uid)) setStatus("Could not load comments.", true);
      }
    );
    commentListeners.set(parent.path, unsubscribe);
  });
};

const stopProfileContent = () => {
  profileContentListeners.forEach((unsubscribe) => unsubscribe());
  profileContentListeners = [];
  commentListeners.forEach((unsubscribe) => unsubscribe());
  commentListeners.clear();
  comments = [];
  targetPosts = [];
  targetCommunityPosts = [];
  profileContentStarted = false;
  for (const [key, unsubscribe] of reportStateWatches) if (!key.startsWith("user:")) {
    unsubscribe(); reportStateWatches.delete(key); reportStateLoads.delete(key);
  }
};
const renderPosts = () => {
  if (!viewerBlocks.ready) {
    feed.replaceChildren();
    document.getElementById("profile-post-count").textContent = "";
    setStatus("Loading privacy choices…");
    return;
  }
  if (targetBlocked) {
    feed.replaceChildren();
    document.getElementById("profile-post-count").textContent = "0 posts";
    setStatus(targetBlockedByViewer ? blockedProfileStatus() : "This profile is unavailable because of a block.");
    return;
  }
  const sorted = [...targetPosts, ...targetCommunityPosts]
    .filter((post) => !post.data().expiresAt?.toMillis?.() || post.data().expiresAt.toMillis() > Date.now())
    .filter((post) => isBlockedPost(post, viewerBlocks))
    .sort(compareNewestFirst);

  feed.replaceChildren(...sorted.map((postDoc) => {
    const post = postDoc.data();
    const item = document.createElement("li");
    item.className = "feed-item";
    if (targetPremiumSettings) applyPremiumTheme(item, targetPremiumSettings);

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
    const postImage = post.imageData ? document.createElement("img") : null;
    if (postImage) {
      postImage.className = "post-image";
      postImage.loading = "lazy";
      postImage.decoding = "async";
      postImage.src = post.imageData;
      postImage.alt = "Photo attached to this post";
    }
    const time = document.createElement("small");
    time.textContent = post.createdAt?.toDate
      ? post.createdAt.toDate().toLocaleString()
      : "Posting…";
    const parent = interactionParentForPost(postDoc);
    const sourceCollection = postDoc.ref.parent.id;
    const commentDocs = postComments(postDoc);
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
      if (!commentText) return;
      submit.disabled = true;
      try {
        await addDoc(collection(db, parent.collection, parent.id, "comments"), {
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
    commentsSection.append(summary, list, form);

    const postActions = document.createElement("div");
    postActions.className = "post-actions";
    if (post.authorId !== currentUser.uid) {
      const reportTarget = postReportTarget(postDoc, post);
      const reported = moderationClient.cachedReported(reportTarget);
      const postReportReason = document.createElement("select");
      postReportReason.setAttribute("aria-label", "Reason for reporting this post");
      [
        ["harassment", "Harassment"], ["hate-threats", "Hate or threats"],
        ["sexual-content", "Sexual content"], ["spam-scam", "Spam or scam"],
        ["privacy-impersonation", "Privacy or impersonation"], ["other", "Other"]
      ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        postReportReason.append(option);
      });
      const reportPost = document.createElement("button");
      reportPost.type = "button";
      reportPost.className = REPORT_BUTTON_CLASS;
      reportPost.textContent = reported === true ? "Reported" : reported === false ? "Report" : "Checking report…";
      reportPost.disabled = reported !== false;
      postReportReason.disabled = reported === true;
      loadReportedState(reportTarget, schedulePostsRender);
      reportPost.addEventListener("click", async () => {
        reportPost.disabled = true;
        try {
          await moderationClient.report(reportTarget, postReportReason.value);
          removeReportedPostFromLocalState(postDoc.ref.path);
          reportPost.textContent = "Reported";
          postReportReason.disabled = true;
          setStatus("Report sent. Thank you for helping keep AnonChat safe.");
        } catch (error) {
          setStatus(error?.code === "already-reported" ? "You have already reported this post." : "Could not report this post.", true);
          const duplicate = moderationClient.cachedReported(reportTarget) === true;
          reportPost.textContent = duplicate ? "Reported" : "Report";
          postReportReason.disabled = duplicate;
          reportPost.disabled = duplicate;
        }
      });
      postActions.append(postReportReason, reportPost);
    }
    if (post.authorId === currentUser.uid) {
      const removePost = document.createElement("button");
      removePost.type = "button";
      removePost.className = "delete-button";
      removePost.textContent = "Delete";
      removePost.addEventListener("click", async () => {
        if (!window.confirm("Permanently delete this post? This cannot be undone.")) return;
        removePost.disabled = true;
        try {
          await deleteDoc(postDoc.ref);
        } catch {
          setStatus("Could not delete that post.", true);
          removePost.disabled = false;
        }
      });
      postActions.append(removePost);
    }

    item.append(text);
    if (postImage) item.append(postImage);
    item.append(time, commentsSection, postActions);
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

const createUserReportDialog = () => {
  const dialog = document.createElement("dialog");
  dialog.className = "report-dialog";
  const form = document.createElement("form");
  form.method = "dialog";
  const title = document.createElement("h2");
  title.textContent = "Report user";
  const label = document.createElement("label");
  label.textContent = "Why are you reporting this user?";
  const reason = document.createElement("select");
  reason.required = true;
  REPORT_REASONS.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value.replaceAll("-", " ");
    reason.append(option);
  });
  label.append(reason);
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
  cancel.addEventListener("click", () => dialog.close());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    cancel.disabled = true;
    dialogStatus.textContent = "Submitting report…";
    try {
      await moderationClient.report(userReportTarget(), reason.value);
      dialog.close();
      setStatus("Report sent. Thank you for helping keep AnonChat safe.");
      renderFollowControl();
    } catch (error) {
      if (error?.code === "already-reported") {
        dialog.close();
        setStatus("You have already reported this user.");
        renderFollowControl();
      } else {
        dialogStatus.textContent = "Could not report this user. Please try again.";
        submit.disabled = false;
        cancel.disabled = false;
      }
    }
  });
  actions.append(cancel, submit);
  form.append(title, label, dialogStatus, actions);
  dialog.append(form);
  document.body.append(dialog);
  return dialog;
};

let userReportDialog;
reportButton.addEventListener("click", () => {
  userReportDialog ||= createUserReportDialog();
  userReportDialog.querySelector("form").reset();
  userReportDialog.querySelector(".report-dialog-status").textContent = "";
  userReportDialog.showModal();
});

const startProfileContent = () => {
  if (profileContentStarted || targetBlocked) return;
  const session = activeProfileSession;
  const uid = currentUser?.uid;
  const sessionIsCurrent = () => sessionGeneration.isCurrent(session, uid);
  profileContentStarted = true;
  profileContentListeners.push(onSnapshot(
    query(
      collection(db, "posts"),
      where("authorId", "==", targetUserId),
      where("moderationState", "==", "visible"),
      orderBy("createdAt", "desc"),
      limit(PROFILE_FEED_LIMIT)
    ),
    (snapshot) => {
      if (!sessionIsCurrent()) return;
      targetPosts = snapshot.docs;
      syncProfilePostResources([...targetPosts, ...targetCommunityPosts]);
      schedulePostsRender();
    },
    () => { if (sessionIsCurrent()) setStatus("Could not load this user's posts.", true); }
  ));

  profileContentListeners.push(onSnapshot(
    query(
      collection(db, "communityPosts"),
      where("authorId", "==", targetUserId),
      where("moderationState", "==", "visible"),
      orderBy("createdAt", "desc"),
      limit(PROFILE_FEED_LIMIT)
    ),
    (snapshot) => {
      if (!sessionIsCurrent()) return;
      targetCommunityPosts = snapshot.docs;
      syncProfilePostResources([...targetPosts, ...targetCommunityPosts]);
      schedulePostsRender();
    },
    () => { if (sessionIsCurrent()) setStatus("Could not load this user's earlier posts.", true); }
  ));
};

const refreshViewerBlocks = () => {
  viewerBlocks = blockTracker.current();
  if (!viewerBlocks.ready) {
    stopProfileContent();
    clearProtectedProfileMetadata("Loading privacy choices…");
    renderFollowControl();
    renderPosts();
    return;
  }
  targetBlocked = isBlockedActor(targetUserId, viewerBlocks);
  targetBlockedByViewer = didViewerBlock(targetUserId, viewerBlocks);
  renderTargetProfileIdentity();
  if (targetBlocked) stopProfileContent();
  else startProfileContent();
  renderFollowControl();
  renderPosts();
};

const startViewerBlockListeners = (session, uid) => new Promise((resolve) => {
  let resolved = false;
  const sessionIsCurrent = () => sessionGeneration.isCurrent(session, uid);
  const ready = () => {
    if (!sessionIsCurrent()) return;
    refreshViewerBlocks();
    if (viewerBlocks.ready && !resolved) {
      resolved = true;
      resolve();
    }
  };
  sessionListeners.push(onSnapshot(
    query(collection(db, "blocks"), where("blockerUid", "==", uid)),
    (snapshot) => {
      if (!sessionIsCurrent()) return;
      viewerBlocks = blockTracker.update("outgoing", snapshot.docs);
      ready();
    },
    () => {
      if (!sessionIsCurrent()) return;
      viewerBlocks = blockTracker.fail("outgoing");
      refreshViewerBlocks();
      setStatus("Could not load this block status.", true);
    }
  ));
  sessionListeners.push(onSnapshot(
    query(collection(db, "blocks"), where("blockedUid", "==", uid)),
    (snapshot) => {
      if (!sessionIsCurrent()) return;
      viewerBlocks = blockTracker.update("incoming", snapshot.docs);
      ready();
    },
    () => {
      if (!sessionIsCurrent()) return;
      viewerBlocks = blockTracker.fail("incoming");
      refreshViewerBlocks();
      setStatus("Could not load this block status.", true);
    }
  ));
});

blockButton.addEventListener("click", async () => {
  blockButton.disabled = true;
  try {
    if (targetBlockedByViewer) {
      await moderationClient.unblock(targetUserId);
      targetBlocked = false;
      setStatus("You unblocked this user. Their posts are visible again.");
      startProfileContent();
    } else {
      await moderationClient.block(targetUserId);
      targetBlocked = true;
      stopProfileContent();
      setStatus(blockedProfileStatus());
    }
    renderFollowControl();
    renderPosts();
  } catch (error) {
    setStatus(error?.message || "Could not update this block.", true);
    blockButton.disabled = false;
  }
});

const stopProfileResources = () => {
  exactFollowerCount = null;
  exactFollowingCount = null;
  moderationClient?.destroy();
  sessionListeners.splice(0).forEach((unsubscribe) => unsubscribe());
  stopProfileContent();
  for (const unsubscribe of reportStateWatches.values()) unsubscribe();
  reportStateWatches.clear();
  reportStateLoads.clear();
  users = [];
  follows = [];
  targetProfile = null;
  moderationClient = null;
  currentProfileUsername = "";
  targetBlocked = false;
  targetBlockedByViewer = false;
  blockTracker.reset(currentUser?.uid);
  viewerBlocks = blockTracker.current();
  socialActions.hidden = true;
  feed.replaceChildren();
  document.getElementById("profile-post-count").textContent = "";
  clearProtectedProfileMetadata("Loading profile…");
};

const invalidateProfileSession = () => {
  sessionGeneration.invalidate();
  stopProfileResources();
};

onAuthStateChanged(auth, async (user) => {
  activeProfileSession = sessionGeneration.begin(user?.uid);
  const session = activeProfileSession;
  const sessionIsCurrent = () => sessionGeneration.isCurrent(session, user?.uid);
  stopProfileResources();
  if (!user) {
    currentUser = null;
    stopProfileResources();
    const destination = targetUserId
      ? `index.html?next=${encodeURIComponent(`profile.html?uid=${targetUserId}`)}`
      : "index.html";
    await exitAfterAuthLoss({ redirect: () => window.location.replace(destination) });
    return;
  }
  if (!user.emailVerified) {
    await exitAuthenticatedSession({ user, stopListeners: stopProfileResources, redirect: () => window.location.replace("index.html") });
    return;
  }

  if (!targetUserId) {
    window.location.replace("timeline.html");
    return;
  }

  currentUser = user;
  blockTracker = createViewerBlockTracker(user.uid);
  viewerBlocks = blockTracker.current();
  const currentProfileRef = doc(db, "users", user.uid);
  let currentProfileSnapshot = await getDoc(currentProfileRef);
  if (!sessionIsCurrent()) return;
  if (currentProfileSnapshot.exists() && currentProfileSnapshot.data().banned === true) {
    await exitAuthenticatedSession({
      user,
      stopListeners: stopProfileResources,
      redirect: () => window.location.replace("index.html")
    });
    return;
  }
  if (!currentProfileSnapshot.exists() || !validProfile(currentProfileSnapshot.data(), user.uid)) {
    currentProfileUsername = await ensureUserProfile(user, db);
    if (!sessionIsCurrent()) return;
    currentProfileSnapshot = await getDoc(currentProfileRef);
    if (!sessionIsCurrent()) return;
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
  if (!sessionIsCurrent()) return;
  if (
    targetUserId === user.uid &&
    (!profileSnapshot.exists() || !validProfile(profileSnapshot.data(), user.uid))
  ) {
    await ensureUserProfile(user, db);
    if (!sessionIsCurrent()) return;
    profileSnapshot = await getDoc(targetProfileRef);
    if (!sessionIsCurrent()) return;
  }
  if (!profileSnapshot.exists()) {
    document.getElementById("profile-name").textContent = "Profile not found";
    setStatus("This anonymous profile does not exist.", true);
    return;
  }

  targetProfile = profileSnapshot.data();
  users = [currentProfileSnapshot, profileSnapshot].filter((entry, index, list) => entry.exists() && list.findIndex(other => other.id === entry.id) === index);
  const [premiumSnapshot, settingsSnapshot] = await Promise.all([getDoc(doc(db, "premiumAccess", targetUserId)), getDoc(doc(db, "premiumSettings", targetUserId))]);
  if (!sessionIsCurrent()) return;
  targetPremiumAccess = premiumSnapshot.exists() ? premiumSnapshot.data() : null;
  targetPremiumSettings = settingsSnapshot.exists() && hasPremiumAccess(targetPremiumAccess) ? resolvedPremiumSettings(targetUserId, settingsSnapshot.data()) : null;
  if (targetProfile.banned === true && currentUser.uid !== targetUserId) {
    document.getElementById("profile-name").textContent = "Unavailable profile";
    setStatus("This account is banned.", true);
    return;
  }
  moderationClient = createModerationClient({
    db,
    firestore: { doc, getDoc, setDoc, deleteDoc, writeBatch },
    currentUid: currentUser.uid,
    timestamp: serverTimestamp
  });
  await startViewerBlockListeners(session, user.uid);
  if (!sessionIsCurrent()) return;
  renderTargetProfileIdentity();
  const viewerIsAdmin = isDesignatedAdmin(currentProfileUsername);
  const targetIsAdmin = isDesignatedAdmin(targetProfile.username);
  document.getElementById("profile-admin-link").hidden =
    !(viewerIsAdmin && targetIsAdmin && currentUser.uid === targetUserId);
  if (shouldRecordDailyPageView()) {
    const viewDay = new Date().toISOString().slice(0, 10);
    setDoc(doc(db, "pageViews", viewDay), { date: viewDay, views: increment(1), updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
  }

  const followSets = { followers: [], following: [] };
  const syncFollows = () => { follows = [...followSets.followers, ...followSets.following.filter(entry => !followSets.followers.some(other => other.id === entry.id))]; renderFollowControl(); };
  sessionListeners.push(onSnapshot(query(collection(db, "follows"), where("followingId", "==", targetUserId), limit(50)), snapshot => {
    if (!sessionIsCurrent()) return; followSets.followers = snapshot.docs; syncFollows();
  }, () => { if (sessionIsCurrent()) setStatus("Could not load followers.", true); }));
  sessionListeners.push(onSnapshot(query(collection(db, "follows"), where("followerId", "==", targetUserId), limit(50)), snapshot => {
    if (!sessionIsCurrent()) return; followSets.following = snapshot.docs; syncFollows();
  }, () => { if (sessionIsCurrent()) setStatus("Could not load following.", true); }));
  Promise.all([
    getCountFromServer(query(collection(db, "follows"), where("followingId", "==", targetUserId))),
    getCountFromServer(query(collection(db, "follows"), where("followerId", "==", targetUserId)))
  ]).then(([followers, following]) => {
    if (!sessionIsCurrent()) return;
    exactFollowerCount = followers.data().count;
    exactFollowingCount = following.data().count;
    renderFollowControl();
  }).catch(() => {});
  if (targetUserId !== user.uid) sessionListeners.push(onSnapshot(doc(db, "follows", `${user.uid}_${targetUserId}`), snapshot => {
    if (!sessionIsCurrent()) return;
    followSets.following = [
      ...followSets.following.filter(entry => entry.id !== snapshot.id),
      ...(snapshot.exists() ? [snapshot] : [])
    ];
    syncFollows();
  }));

  renderFollowControl();
  renderPosts();
  startProfileContent();
});

window.addEventListener("pagehide", (event) => {
  if (!event.persisted) {
    sessionGeneration.invalidate();
    stopProfileResources();
  }
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !moderationClient || !currentUser || !targetProfile) return;
  moderationClient.invalidateNegative();
  renderFollowControl(); schedulePostsRender(); startProfileContent();
});
