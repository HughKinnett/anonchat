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
let currentUser;
let profileUsername;
let postDocs = [];
let reactions = [];
const listeners = [];

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#b00020" : "inherit";
};

const postReactions = (postId) => reactions.filter((reaction) =>
  reaction.ref.parent.parent?.id === postId
);

const toggleReaction = async (postId, type) => {
  const reactionRef = doc(db, "posts", postId, "reactions", currentUser.uid);
  const existing = reactions.find((reaction) =>
    reaction.ref.path === reactionRef.path
  );

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

const reactionButton = (postId, type, emoji, postReactionDocs) => {
  const count = postReactionDocs.filter((reaction) => reaction.data().type === type).length;
  const selected = postReactionDocs.some((reaction) =>
    reaction.id === currentUser.uid && reaction.data().type === type
  );
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `${emoji} ${count}`;
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

const renderPost = (postDoc) => {
  const post = postDoc.data();
  const item = document.createElement("li");
  item.className = "feed-item";

  const author = document.createElement("h3");
  author.textContent = `@${post.username}`;
  const text = document.createElement("p");
  text.textContent = post.content;
  const time = document.createElement("small");
  time.textContent = post.createdAt?.toDate
    ? post.createdAt.toDate().toLocaleString()
    : "Posting…";

  const postReactionDocs = postReactions(postDoc.id);
  const reactionBar = document.createElement("div");
  reactionBar.className = "reactions";
  reactionBar.append(
    reactionButton(postDoc.id, "heart", "❤️", postReactionDocs),
    reactionButton(postDoc.id, "middle_finger", "🖕", postReactionDocs)
  );

  item.append(author, text, time, reactionBar);

  if (post.authorId === currentUser.uid) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      remove.disabled = true;
      try {
        await deleteDoc(doc(db, "posts", postDoc.id));
      } catch {
        setStatus("Could not delete that post.", true);
        remove.disabled = false;
      }
    });
    item.append(remove);
  }
  return item;
};

const renderFeed = () => {
  feed.replaceChildren(...postDocs.map(renderPost));
  setStatus(postDocs.length ? "" : "No posts yet. Start the conversation.");
};

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
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const postContent = content.value.trim();
  if (!currentUser || !postContent || postContent.length > 500) return;

  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    await addDoc(collection(db, "posts"), {
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
