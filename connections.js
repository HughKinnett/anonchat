import { auth, db } from "./firebase-config.js";
import { resolveConnectionsTarget } from "./connections-target.mjs";
import { recordPageActivity } from "./activity-integration.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let targetUserId = new URLSearchParams(location.search).get("uid");
const status = document.getElementById("connections-status");
const followersList = document.getElementById("followers-list");
const followingList = document.getElementById("following-list");
let currentUser;
let users = [];
let follows = [];

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#fca5a5" : "inherit";
};

const profileFor = (uid) => users.find((entry) => entry.id === uid);
const viewerFollows = (uid) => follows.some((entry) => {
  const data = entry.data();
  return data.followerId === currentUser.uid && data.followingId === uid;
});

const toggleFollow = async (uid) => {
  const followRef = doc(db, "follows", `${currentUser.uid}_${uid}`);
  if (viewerFollows(uid)) {
    await deleteDoc(followRef);
  } else {
    await setDoc(followRef, {
      followerId: currentUser.uid,
      followingId: uid,
      createdAt: serverTimestamp()
    });
  }
};

const personCard = (uid) => {
  const profile = profileFor(uid);
  if (!profile || profile.data().banned === true) return null;
  const data = profile.data();
  const row = document.createElement("article");
  row.className = "connection-card";
  const link = document.createElement("a");
  link.className = "connection-person";
  link.href = `profile.html?uid=${encodeURIComponent(uid)}`;
  const avatar = document.createElement("img");
  avatar.src = data.profileImage || "Untitled.jpeg";
  avatar.alt = "";
  const name = document.createElement("strong");
  name.textContent = `@${data.username || "anonymous"}`;
  link.append(avatar, name);
  row.append(link);

  if (uid !== currentUser.uid) {
    const button = document.createElement("button");
    button.className = "follow-button";
    button.type = "button";
    const following = viewerFollows(uid);
    button.textContent = following ? "Unfollow" : "Follow";
    button.setAttribute("aria-pressed", String(following));
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await toggleFollow(uid);
      } catch {
        setStatus("Could not update that follow.", true);
        button.disabled = false;
      }
    });
    row.append(button);
  }
  return row;
};

const render = () => {
  if (!currentUser || !targetUserId) return;
  const target = profileFor(targetUserId);
  if (target) {
    document.getElementById("connections-title").textContent =
      `@${target.data().username || "anonymous"}’s connections`;
  }
  const followerIds = follows
    .filter((entry) => entry.data().followingId === targetUserId)
    .map((entry) => entry.data().followerId);
  const followingIds = follows
    .filter((entry) => entry.data().followerId === targetUserId)
    .map((entry) => entry.data().followingId);
  document.getElementById("followers-count").textContent = followerIds.length;
  document.getElementById("following-count").textContent = followingIds.length;

  const followerCards = followerIds.map(personCard).filter(Boolean);
  const followingCards = followingIds.map(personCard).filter(Boolean);
  followersList.replaceChildren(...(followerCards.length
    ? followerCards
    : [Object.assign(document.createElement("p"), { className: "connections-empty", textContent: "No followers yet." })]));
  followingList.replaceChildren(...(followingCards.length
    ? followingCards
    : [Object.assign(document.createElement("p"), { className: "connections-empty", textContent: "Not following anyone yet." })]));
  setStatus("");
};

document.getElementById("connections-sign-out").addEventListener("click", async () => {
  await exitAuthenticatedSession({
    user: currentUser,
    redirect: () => location.replace("index.html")
  });
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await exitAfterAuthLoss({ redirect: () => location.replace("index.html") });
    return;
  }
  const target = resolveConnectionsTarget(location.search, user.uid);
  targetUserId = target.targetUserId;
  if (location.search !== target.canonicalSearch) {
    history.replaceState(null, "", `${location.pathname}${target.canonicalSearch}${location.hash}`);
  }
  currentUser = user;
  const profile = await getDoc(doc(db, "users", user.uid));
  void recordPageActivity({
    surface: "connections",
    profile: profile.exists() ? profile.data() : null,
    user,
    db,
    firestore: { doc, updateDoc, serverTimestamp }
  });
  document.getElementById("back-to-profile").href =
    `profile.html?uid=${encodeURIComponent(targetUserId)}`;
  onSnapshot(collection(db, "users"), (snapshot) => {
    users = snapshot.docs;
    render();
  }, () => setStatus("Could not load users.", true));
  onSnapshot(collection(db, "follows"), (snapshot) => {
    follows = snapshot.docs;
    render();
  }, () => setStatus("Could not load connections.", true));
});
