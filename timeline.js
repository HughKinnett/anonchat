import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const feed = document.getElementById("feed");
const form = document.getElementById("post-form");
const content = document.getElementById("post-content");
const status = document.getElementById("timeline-status");
let currentUser;
let stopListening;

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#b00020" : "inherit";
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

  item.append(author, text, time);

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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }

  currentUser = user;
  const profile = await getDoc(doc(db, "users", user.uid));
  const username = profile.exists() ? profile.data().username : user.displayName;
  document.getElementById("display-name").textContent = username || "AnonChat user";
  document.getElementById("user-handle").textContent = username ? `@${username}` : "";

  const postsQuery = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(100));
  stopListening = onSnapshot(postsQuery, (snapshot) => {
    feed.replaceChildren(...snapshot.docs.map(renderPost));
    setStatus(snapshot.empty ? "No posts yet. Start the conversation." : "");
  }, () => setStatus("Could not load posts.", true));
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
      username: currentUser.displayName || "anonymous",
      content: postContent,
      createdAt: serverTimestamp()
    });
    content.value = "";
    setStatus("");
  } catch {
    setStatus("Could not publish your post.", true);
  } finally {
    submit.disabled = false;
  }
});

document.getElementById("sign-out").addEventListener("click", async () => {
  if (stopListening) stopListening();
  await signOut(auth);
  window.location.replace("index.html");
});
