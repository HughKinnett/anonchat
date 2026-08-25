import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const status = document.getElementById("admin-status");
const usersHost = document.getElementById("admin-users");
const postsHost = document.getElementById("admin-posts");
const viewsHost = document.getElementById("admin-views");
const search = document.getElementById("admin-user-search");
let users = [];
let posts = [];
let views = [];

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#fca5a5" : "inherit";
};

const formatDate = (value) => value?.toDate ? value.toDate().toLocaleString() : "Unknown date";

const renderUsers = () => {
  const term = search.value.trim().toLowerCase();
  const filtered = users.filter((entry) => {
    const data = entry.data();
    return !term || data.username?.toLowerCase().includes(term) || entry.id.toLowerCase().includes(term);
  });
  usersHost.replaceChildren(...filtered.map((entry) => {
    const data = entry.data();
    const row = document.createElement("article");
    row.className = "admin-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `@${data.username || "unknown"}${data.banned ? " — BANNED" : ""}`;
    const meta = document.createElement("small");
    meta.textContent = `UID: ${entry.id} · Created: ${formatDate(data.createdAt)}`;
    info.append(name, meta);
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const profile = document.createElement("a");
    profile.className = "admin-action nav-button";
    profile.href = `profile.html?uid=${encodeURIComponent(entry.id)}`;
    profile.textContent = "View";
    const ban = document.createElement("button");
    ban.type = "button";
    ban.className = `admin-action ${data.banned ? "restore" : "danger"}`;
    ban.textContent = data.banned ? "Unban" : "Ban";
    ban.addEventListener("click", async () => {
      ban.disabled = true;
      try {
        await updateDoc(doc(db, "users", entry.id), { banned: !data.banned });
        setStatus(data.banned ? "User unbanned." : "User banned.");
      } catch {
        setStatus("Could not update that user.", true);
        ban.disabled = false;
      }
    });
    actions.append(profile, ban);
    row.append(info, actions);
    return row;
  }));
};

const renderPosts = () => {
  postsHost.replaceChildren(...posts.map((entry) => {
    const data = entry.data();
    const row = document.createElement("article");
    row.className = "admin-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `@${data.username || "unknown"}`;
    const excerpt = document.createElement("small");
    excerpt.textContent = `${data.content || "[Photo post]"} · ${formatDate(data.createdAt)}`;
    info.append(title, excerpt);
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    const open = document.createElement("a");
    open.className = "admin-action nav-button";
    open.href = `timeline.html#post-${entry.id}`;
    open.textContent = "Open";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "admin-action danger";
    remove.textContent = "Delete post";
    remove.addEventListener("click", async () => {
      if (!window.confirm("Delete this post? This cannot be undone.")) return;
      remove.disabled = true;
      try {
        await deleteDoc(doc(db, "posts", entry.id));
        setStatus("Post deleted.");
      } catch {
        setStatus("Could not delete that post.", true);
        remove.disabled = false;
      }
    });
    actions.append(open, remove);
    row.append(info, actions);
    return row;
  }));
};

const renderViews = () => {
  const sorted = [...views].sort((a,b) => b.id.localeCompare(a.id));
  viewsHost.replaceChildren(...sorted.map((entry) => {
    const row = document.createElement("article");
    row.className = "admin-row";
    const day = document.createElement("strong");
    day.textContent = entry.id;
    const count = document.createElement("span");
    count.textContent = `${entry.data().views || 0} views`;
    row.append(day, count);
    return row;
  }));
  document.getElementById("metric-views").textContent =
    views.reduce((sum, entry) => sum + (entry.data().views || 0), 0);
};

search.addEventListener("input", renderUsers);
document.getElementById("admin-sign-out").addEventListener("click", async () => {
  await signOut(auth);
  window.location.replace("index.html");
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }
  const [adminSnapshot, profileSnapshot, statsSnapshot] = await Promise.all([
    getDoc(doc(db, "admins", user.uid)),
    getDoc(doc(db, "users", user.uid)),
    getDoc(doc(db, "system", "accountStats"))
  ]);
  if (!adminSnapshot.exists()) {
    window.location.replace("timeline.html");
    return;
  }
  document.getElementById("admin-identity").textContent =
    `Signed in as @${profileSnapshot.data()?.username || user.displayName || "admin"}`;
  document.getElementById("account-count").textContent = statsSnapshot.data()?.count ?? 0;

  onSnapshot(collection(db, "users"), (snapshot) => {
    users = snapshot.docs;
    document.getElementById("metric-users").textContent = users.length;
    document.getElementById("metric-banned").textContent =
      users.filter((entry) => entry.data().banned === true).length;
    document.getElementById("account-count").textContent = users.length;
    renderUsers();
  }, () => setStatus("Could not load users.", true));

  onSnapshot(query(collection(db, "posts"), orderBy("createdAt", "desc")), (snapshot) => {
    posts = snapshot.docs;
    document.getElementById("metric-posts").textContent = posts.length;
    renderPosts();
  }, () => setStatus("Could not load posts.", true));

  onSnapshot(collection(db, "pageViews"), (snapshot) => {
    views = snapshot.docs;
    renderViews();
  }, () => setStatus("Could not load page views.", true));
});
