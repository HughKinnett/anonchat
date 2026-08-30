import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const ONLINE_WINDOW_MS = 15 * 60 * 1000;
const sessionKey = uid => `anonchat.onlineFollowers.v1.${uid}`;
const timestampMillis = value => typeof value?.toMillis === "function" ? value.toMillis() : 0;

const render = (people) => {
  const menu = document.getElementById("main-menu-panel");
  if (!menu || menu.querySelector(".online-followers-menu")) return;
  const section = document.createElement("section");
  section.className = "online-followers-menu";
  const heading = document.createElement("p");
  heading.className = "online-followers-heading";
  heading.textContent = `Followers online · ${people.length}`;
  const list = document.createElement("div");
  list.className = "online-followers-list";
  if (!people.length) {
    const empty = document.createElement("small");
    empty.textContent = "No followers opened AnonChat recently.";
    list.append(empty);
  } else {
    people.forEach(person => {
      const link = document.createElement("a");
      link.href = `profile.html?uid=${encodeURIComponent(person.uid)}`;
      const dot = document.createElement("span");
      dot.className = "online-dot";
      dot.setAttribute("aria-hidden", "true");
      link.append(dot, document.createTextNode(`@${person.username}`));
      list.append(link);
    });
  }
  section.append(heading, list);
  const anchor = menu.querySelector(".menu-install") || menu.querySelector(".menu-danger");
  menu.insertBefore(section, anchor || null);
};

onAuthStateChanged(auth, async user => {
  if (!user) return;
  const key = sessionKey(user.uid);
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || "null");
    if (Array.isArray(cached)) { render(cached); return; }
  } catch { /* Take a fresh opening snapshot. */ }

  try {
    await setDoc(doc(db, "appPresence", user.uid), { uid: user.uid, openedAt: serverTimestamp() }, { merge: true });
    const follows = await getDocs(query(collection(db, "follows"), where("followingId", "==", user.uid)));
    const followerIds = [...new Set(follows.docs.map(entry => entry.data().followerId).filter(Boolean))].slice(0, 100);
    const now = Date.now();
    const people = (await Promise.all(followerIds.map(async uid => {
      const [presence, profile] = await Promise.all([
        getDoc(doc(db, "appPresence", uid)),
        getDoc(doc(db, "users", uid))
      ]);
      if (!presence.exists() || !profile.exists() || profile.data().banned === true) return null;
      if (now - timestampMillis(presence.data().openedAt) > ONLINE_WINDOW_MS) return null;
      return { uid, username: profile.data().username || "anonymous" };
    }))).filter(Boolean).sort((left, right) => left.username.localeCompare(right.username));
    sessionStorage.setItem(key, JSON.stringify(people));
    render(people);
  } catch {
    render([]);
  }
});
