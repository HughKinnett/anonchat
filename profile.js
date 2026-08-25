import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
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
let follows = [];
let targetProfile;
let targetPosts = [];

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
    item.append(text, time);
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
  const targetProfileRef = doc(db, "users", targetUserId);
  let profileSnapshot = await getDoc(targetProfileRef);
  if (!profileSnapshot.exists() && targetUserId === user.uid && /^[A-Za-z0-9_]{3,30}$/.test(user.displayName || "")) {
    await setDoc(targetProfileRef, {
      uid: user.uid,
      username: user.displayName,
      createdAt: serverTimestamp()
    });
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
