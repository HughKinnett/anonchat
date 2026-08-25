import { auth, db } from "./firebase-config.js";
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
  setDoc
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
let follows = [];
let showingProfile = false;
const listeners = [];

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#fca5a5" : "inherit";
};

const originalPostId = (postDoc) =>
  postDoc.data().type === "repost" ? postDoc.data().originalPostId : postDoc.id;

const postReactions = (postId) => reactions.filter((reaction) =>
  reaction.ref.parent.parent?.id === postId
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

const toggleReaction = async (postId, type) => {
  const reactionRef = doc(db, "posts", postId, "reactions", currentUser.uid);
  const existing = reactions.find((reaction) => reaction.ref.path === reactionRef.path);

  if (existing?.data().type === type) {
    await deleteDoc(reactionRef);
  } else {
    await setDoc(reactionRef, {
      uid: currentUser.uid,
      type,
      createdAt: serverTimestamp()
    });
  }
};

const reactionButton = (postId, type, emoji, reactionDocs) => {
  const count = reactionDocs.filter((reaction) => reaction.data().type === type).length;
  const selected = reactionDocs.some((reaction) =>
    reaction.id === currentUser.uid && reaction.data().type === type
  );
  const button = document.createElement("button");
  button.className = "reaction-button";
  button.type = "button";
  button.textContent = type === "heart" ? `${emoji} Heart · ${count}` : `${emoji} ${count}`;
  button.setAttribute("aria-pressed", String(selected));
  button.title = type === "heart" ? "Heart this post" : "Give this post the middle finger";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await toggleReaction(postId, type);
    } catch {
      setStatus("Could not save your reaction.", true);
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
  const author = document.createElement("h3");
  author.textContent = `@${displayedUsername}`;
  authorRow.append(author, createFollowControl(displayedAuthorId));
  const text = document.createElement("p");
  text.textContent = post.content;
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

  item.append(authorRow, text, time, reactionsBar, actions);
  return item;
};

const renderFeed = () => {
  const visiblePosts = showingProfile
    ? postDocs.filter((post) => post.data().authorId === currentUser.uid)
    : postDocs;

  feed.replaceChildren(...visiblePosts.map(renderPost));
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
  const profile = await getDoc(doc(db, "users", user.uid));
  profileUsername = profile.exists() ? profile.data().username : user.displayName;
  document.getElementById("display-name").textContent = profileUsername || "AnonChat user";
  document.getElementById("user-handle").textContent = profileUsername ? `@${profileUsername}` : "";

  listeners.push(onSnapshot(
    query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100)),
    (snapshot) => {
      postDocs = snapshot.docs;
      renderFeed();
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
