import { auth, db } from "./firebase-config.js";
import { localRecentViews } from "./user-experience-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, deleteDoc, doc, getDoc, getDocs, limit, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let viewer = null;
const keyFor = (collectionName, id) => `${collectionName}__${id}`;

const card = ({ title, text, href, remove }) => {
  const item = document.createElement("article"); item.className = "saved-item";
  const heading = document.createElement("strong"); heading.textContent = title;
  const copy = document.createElement("p"); copy.textContent = text || "Post";
  const actions = document.createElement("div"); actions.className = "ux-actions";
  const open = document.createElement("a"); open.className = "secondary-button"; open.href = href; open.textContent = "Open"; actions.append(open);
  if (remove) { const button = document.createElement("button"); button.type = "button"; button.className = "secondary-button"; button.textContent = "Remove"; button.onclick = remove; actions.append(button); }
  item.append(heading, copy, actions); return item;
};

const renderRecent = () => {
  if (!viewer) return; const host = $("recent-views"); const views = localRecentViews(localStorage, viewer.uid, 40);
  host.replaceChildren(...views.map((view) => card({ title: "Recently viewed", text: view.text, href: `timeline.html#post-${encodeURIComponent(view.postId)}` })));
  if (!views.length) host.textContent = "No recently viewed posts on this device.";
};

const loadSaved = async () => {
  if (!viewer) return; const status = $("saved-status"); const host = $("saved-posts"); status.textContent = "Loading…";
  try {
    const snapshot = await getDocs(query(collection(db, "savedPosts", viewer.uid, "items"), limit(100)));
    const rows = [];
    for (const saved of snapshot.docs) {
      const data = saved.data();
      if (!["posts", "communityPosts"].includes(data.targetCollection)) continue;
      let text = data.snapshotText || "Post";
      try {
        const post = await getDoc(doc(db, data.targetCollection, data.targetId));
        if (post.exists() && post.data().moderationState !== "hidden") {
          const edit = await getDoc(doc(db, "contentEdits", keyFor(data.targetCollection, data.targetId)));
          text = edit.exists() ? edit.data().content : post.data().content || text;
        }
      } catch {}
      rows.push(card({ title: "🔖 Saved post", text, href: `timeline.html#post-${encodeURIComponent(data.targetId)}`, remove: async () => { await deleteDoc(saved.ref); await loadSaved(); } }));
    }
    host.replaceChildren(...rows); status.textContent = rows.length ? `${rows.length} saved ${rows.length === 1 ? "post" : "posts"}` : "You have not saved any posts yet.";
  } catch { status.textContent = "Could not load Saved right now."; }
};

$("clear-recent-views")?.addEventListener("click", () => { if (!viewer) return; localStorage.removeItem(`anonchat:recent-views:${viewer.uid}`); renderRecent(); });
onAuthStateChanged(auth, (user) => { if (!user) { location.href = "index.html"; return; } viewer = user; void loadSaved(); renderRecent(); });
