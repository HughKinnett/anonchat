import { auth, db } from "./firebase-config.js";
import { ensureUserProfile } from "./legacy-profile.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const targetUserId = new URLSearchParams(window.location.search).get("uid");
const feed = document.getElementById("profile-feed");
const status = document.getElementById("profile-status");
const followButton = document.getElementById("profile-follow-button");
let currentUser;
let currentProfileUsername;
let comments = [];
let follows = [];
let targetProfile;
let targetPosts = [];

const validProfile = (profile, userId) =>
  profile?.uid === userId &&
  typeof profile.username === "string" &&
  /^[A-Za-z0-9_]{3,30}$/.test(profile.username);

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#fca5a5" : "inherit";
};

const followerCount = () =>
  follows.filter((follow) => follow.data().followingId === targetUserId).length;

const isFollowing = () =>
  follows.some((follow) =>
    follow.data().followerId === currentUser.uid && follow.data().followingId === targetUserId
  );

const renderFollowControl = () => {
  const count = followerCount();
  document.getElementById("profile-followers").textContent =
    `${count} ${count === 1 ? "follower" : "followers"}`;

  if (currentUser.uid === targetUserId) {
    followButton.hidden = true;
    return;
  }

  followButton.hidden = false;
  followButton.setAttribute("aria-pressed", String(isFollowing()));
  followButton.textContent = isFollowing() ? "Following" : "Follow";
  followButton.disabled = false;
};

const postComments = (postId) => comments
  .filter((comment) => comment.ref.parent.parent?.id === postId)
  .sort((a, b) =>
    (a.data().createdAt?.toMillis?.() || 0) - (b.data().createdAt?.toMillis?.() || 0)
  );

const renderPosts = () => {
  const sorted = [...targetPosts].sort((a, b) => {
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
    text.textContent = post.content;
    const time = document.createElement("small");
    time.textContent = post.createdAt?.toDate
      ? post.createdAt.toDate().toLocaleString()
      : "Posting…";
    const sourceId = post.type === "repost" ? post.originalPostId : postDoc.id;
    const commentDocs = postComments(sourceId);
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
      body.textContent = comment.text;
      const commentTime = document.createElement("time");
      commentTime.textContent = comment.createdAt?.toDate
        ? comment.createdAt.toDate().toLocaleString()
        : "Posting…";
      commentItem.append(author, body, commentTime);
      list.append(commentItem);
    });

    const form = document.createElement("form");
    form.className = "comment-form";
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 280;
    input.required = true;
    input.placeholder = "Write a comment…";
    input.setAttribute("aria-label", "Write a comment");
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Comment";
    form.append(input, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const commentText = input.value.trim();
      if (!commentText) return;
      submit.disabled = true;
      try {
        await addDoc(collection(db, "posts", sourceId, "comments"), {
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

    item.append(text, time, commentsSection);
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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    const destination = targetUserId
      ? `index.html?next=${encodeURIComponent(`profile.html?uid=${targetUserId}`)}`
      : "index.html";
    window.location.replace(destination);
    return;
  }

  if (!targetUserId) {
    window.location.replace("timeline.html");
    return;
  }

  currentUser = user;
  const currentProfileRef = doc(db, "users", user.uid);
  let currentProfileSnapshot = await getDoc(currentProfileRef);
  if (!currentProfileSnapshot.exists() || !validProfile(currentProfileSnapshot.data(), user.uid)) {
    currentProfileUsername = await ensureUserProfile(user, db);
    currentProfileSnapshot = await getDoc(currentProfileRef);
  } else {
    currentProfileUsername = currentProfileSnapshot.data().username;
  }

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
  document.title = `@${targetProfile.username} — AnonChat`;
  document.getElementById("profile-name").textContent = targetProfile.username;
  document.getElementById("profile-handle").textContent = `@${targetProfile.username}`;

  onSnapshot(collectionGroup(db, "comments"), (snapshot) => {
    comments = snapshot.docs;
    renderPosts();
  }, () => setStatus("Could not load comments.", true));

  onSnapshot(collection(db, "follows"), (snapshot) => {
    follows = snapshot.docs;
    renderFollowControl();
  }, () => setStatus("Could not load follower information.", true));

  onSnapshot(
    query(collection(db, "posts"), where("authorId", "==", targetUserId)),
    (snapshot) => {
      targetPosts = snapshot.docs;
      renderPosts();
    },
    () => setStatus("Could not load this user's posts.", true)
  );
});
