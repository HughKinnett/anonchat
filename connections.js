import { auth, db } from "./firebase-config.js";
import { resolveConnectionsTarget } from "./connections-target.mjs";
import { clearConnectionsProtectedMetadata } from "./protected-metadata-policy.mjs";
import { recordPageActivity } from "./activity-integration.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { createViewerBlockTracker, isBlockedActor, visibleRecords } from "./viewer-block-policy.mjs";
import { createSessionGeneration } from "./session-generation-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getCountFromServer,
  limit,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let targetUserId = new URLSearchParams(location.search).get("uid");
const status = document.getElementById("connections-status");
const followersList = document.getElementById("followers-list");
const followingList = document.getElementById("following-list");
let currentUser;
let users = [];
let follows = [];
let exactFollowerCount = null;
let exactFollowingCount = null;
const followGroups = new Map();
let blockTracker = createViewerBlockTracker();
let viewerBlocks = blockTracker.current();
const listeners = [];
const sessionGeneration = createSessionGeneration();
let activeConnectionsSession = 0;

const setStatus = (message, isError = false) => {
  status.textContent = message;
  status.style.color = isError ? "#fca5a5" : "inherit";
};

const clearProtectedConnectionsMetadata = (message) => {
  clearConnectionsProtectedMetadata({ document, followersList, followingList }, message);
};

const profileFor = (uid) => users.find((entry) => entry.id === uid);
const hydrateProfiles = async () => {
  const ids = new Set([currentUser?.uid, targetUserId]);
  follows.forEach((entry) => { ids.add(entry.data().followerId); ids.add(entry.data().followingId); });
  const snapshots = await Promise.all([...ids].filter(Boolean).map((uid) => getDoc(doc(db, "users", uid))));
  users = snapshots.filter((snapshot) => snapshot.exists());
  render();
};
const blockedUid = (uid) => isBlockedActor(uid, viewerBlocks);
const visibleFollows = () => visibleRecords(follows, viewerBlocks, ["followerId", "followingId"]);
const viewerFollows = (uid) => visibleFollows().some((entry) => {
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
  if (!profile || profile.data().banned === true || blockedUid(uid)) return null;
  const data = profile.data();
  const row = document.createElement("article");
  row.className = "connection-card";
  const link = document.createElement("a");
  link.className = "connection-person";
  link.href = `profile.html?uid=${encodeURIComponent(uid)}`;
  const avatar = document.createElement("img");
  avatar.src = data.profileImage || "anonchat-anonymous.png";
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
  if (!viewerBlocks.ready) {
    clearProtectedConnectionsMetadata("Loading connections…");
    setStatus("Loading privacy choices…");
    return;
  }
  if (targetUserId !== currentUser.uid && blockedUid(targetUserId)) {
    document.getElementById("connections-title").textContent = "Connections unavailable";
    document.getElementById("followers-count").textContent = "0";
    document.getElementById("following-count").textContent = "0";
    followersList.replaceChildren();
    followingList.replaceChildren();
    setStatus("These connections are unavailable because of a block.");
    return;
  }
  const target = profileFor(targetUserId);
  if (target) {
    document.getElementById("connections-title").textContent =
      `@${target.data().username || "anonymous"}’s connections`;
  }
  const followerIds = visibleFollows()
    .filter((entry) => entry.data().followingId === targetUserId)
    .map((entry) => entry.data().followerId);
  const followingIds = visibleFollows()
    .filter((entry) => entry.data().followerId === targetUserId)
    .map((entry) => entry.data().followingId);
  document.getElementById("followers-count").textContent = exactFollowerCount ?? followerIds.length;
  document.getElementById("following-count").textContent = exactFollowingCount ?? followingIds.length;

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
    stopListeners: invalidateConnectionsSession,
    redirect: () => location.replace("index.html")
  });
});

const stopConnectionsListeners = () => {
  listeners.splice(0).forEach((unsubscribe) => unsubscribe());
  users = [];
  follows = [];
  exactFollowerCount = null;
  exactFollowingCount = null;
  followGroups.clear();
  blockTracker.reset(currentUser?.uid);
  viewerBlocks = blockTracker.current();
  clearProtectedConnectionsMetadata("Loading connections…");
  render();
};

const invalidateConnectionsSession = () => {
  sessionGeneration.invalidate();
  stopConnectionsListeners();
};

onAuthStateChanged(auth, async (user) => {
  activeConnectionsSession = sessionGeneration.begin(user?.uid);
  const session = activeConnectionsSession;
  const sessionIsCurrent = () => sessionGeneration.isCurrent(session, user?.uid);
  stopConnectionsListeners();
  if (!user) {
    currentUser = null;
    await exitAfterAuthLoss({ redirect: () => location.replace("index.html") });
    return;
  }
  const target = resolveConnectionsTarget(location.search, user.uid);
  targetUserId = target.targetUserId;
  if (location.search !== target.canonicalSearch) {
    history.replaceState(null, "", `${location.pathname}${target.canonicalSearch}${location.hash}`);
  }
  currentUser = user;
  blockTracker = createViewerBlockTracker(user.uid);
  viewerBlocks = blockTracker.current();
  const profile = await getDoc(doc(db, "users", user.uid));
  if (!sessionIsCurrent()) return;
  void recordPageActivity({
    surface: "connections",
    profile: profile.exists() ? profile.data() : null,
    user,
    db,
    firestore: { doc, updateDoc, serverTimestamp }
  });
  document.getElementById("back-to-profile").href =
    `profile.html?uid=${encodeURIComponent(targetUserId)}`;
  const listenForSession = (reference, next, failed) => listeners.push(onSnapshot(
    reference,
    (snapshot) => { if (sessionIsCurrent()) next(snapshot); },
    (error) => { if (sessionIsCurrent()) failed?.(error); }
  ));
  const followQueries = [
    ["target-followers", query(collection(db, "follows"), where("followingId", "==", targetUserId), limit(50))],
    ["target-following", query(collection(db, "follows"), where("followerId", "==", targetUserId), limit(50))]
  ];
  if (targetUserId !== user.uid) followQueries.push(["viewer-following", query(collection(db, "follows"), where("followerId", "==", user.uid), limit(100))]);
  followQueries.forEach(([key, reference]) => listenForSession(reference, (snapshot) => {
    followGroups.set(key, snapshot.docs);
    follows = [...new Map([...followGroups.values()].flat().map((entry) => [entry.id, entry])).values()];
    void hydrateProfiles();
  }, () => setStatus("Could not load connections.", true)));
  Promise.all([
    getCountFromServer(query(collection(db, "follows"), where("followingId", "==", targetUserId))),
    getCountFromServer(query(collection(db, "follows"), where("followerId", "==", targetUserId)))
  ]).then(([followers, following]) => {
    if (!sessionIsCurrent()) return;
    exactFollowerCount = followers.data().count;
    exactFollowingCount = following.data().count;
    render();
  }).catch(() => {});
  await hydrateProfiles();
  const refreshBlocks = () => {
    viewerBlocks = blockTracker.current();
    render();
  };
  listenForSession(query(collection(db, "blocks"), where("blockerUid", "==", user.uid)), (snapshot) => {
    viewerBlocks = blockTracker.update("outgoing", snapshot.docs);
    refreshBlocks();
  }, () => {
    viewerBlocks = blockTracker.fail("outgoing");
    refreshBlocks();
    setStatus("Could not load block preferences.", true);
  });
  listenForSession(query(collection(db, "blocks"), where("blockedUid", "==", user.uid)), (snapshot) => {
    viewerBlocks = blockTracker.update("incoming", snapshot.docs);
    refreshBlocks();
  }, () => {
    viewerBlocks = blockTracker.fail("incoming");
    refreshBlocks();
    setStatus("Could not load block preferences.", true);
  });
});

addEventListener("pagehide", invalidateConnectionsSession);
