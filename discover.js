import { auth, db } from "./firebase-config.js";
import { extractHashtags, rankDiscoveryPosts, rememberSearch, suggestedPeople, topicCounts } from "./discovery-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, getDocs, limit, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
let viewer = null; let posts = []; let users = []; let follows = [];
const sumReactions = (value) => value && typeof value === "object" ? Object.values(value).reduce((sum, count) => sum + Number(count || 0), 0) : 0;
const millis = (value) => value?.toMillis ? value.toMillis() : value?.seconds ? value.seconds * 1000 : Number(value || 0);

const postCard = (post) => {
  const node = document.createElement("article"); node.className = "discover-item";
  const author = document.createElement("strong"); author.textContent = `@${post.username || "anonymous"}`;
  const text = document.createElement("p"); text.textContent = String(post.content || "Post").slice(0, 280);
  const meta = document.createElement("small"); meta.className = "ux-muted"; meta.textContent = `${post.comments || 0} comments · ${post.reactions || 0} reactions`;
  const actions = document.createElement("div"); actions.className = "ux-actions";
  const open = document.createElement("a"); open.href = `timeline.html#post-${encodeURIComponent(post.id)}`; open.className = "secondary-button"; open.textContent = "Open post"; actions.append(open);
  node.append(author, text, meta, actions); return node;
};
const personCard = (user) => { const node = document.createElement("article"); node.className = "discover-item"; const name = document.createElement("strong"); name.textContent = `@${user.username || "anonymous"}`; const open = document.createElement("a"); open.href = `profile.html?uid=${encodeURIComponent(user.uid)}`; open.textContent = "View profile"; open.className = "secondary-button"; node.append(name, document.createElement("br"), open); return node; };

const recentSearches = () => { try { const list = JSON.parse(localStorage.getItem(`anonchat:recent-searches:${viewer?.uid}`) || "[]"); return Array.isArray(list) ? list : []; } catch { return []; } };
const renderRecentSearches = () => { const host = $("recent-searches"); host.replaceChildren(...recentSearches().map((value) => { const button = document.createElement("button"); button.type = "button"; button.className = "topic-chip"; button.textContent = value; button.onclick = () => { $("discover-search").value = value; runSearch(value); }; return button; })); if (!host.children.length) host.textContent = "No recent searches."; };

const render = () => {
  const requestedTopic = new URLSearchParams(location.search).get("topic")?.toLowerCase();
  const ranked = rankDiscoveryPosts(posts.map((post) => ({ ...post, hashtags: extractHashtags(post.content) })));
  const visible = requestedTopic ? ranked.filter((post) => post.hashtags.includes(requestedTopic)) : ranked;
  $("active-topic").replaceChildren();
  if (requestedTopic) { const chip = document.createElement("span"); chip.className = "topic-chip"; chip.textContent = `Showing #${requestedTopic}`; $("active-topic").append(chip); }
  $("trending-posts").replaceChildren(...visible.slice(0, 8).map(postCard));
  const dayAgo = Date.now() - 86400000; const today = visible.filter((post) => millis(post.createdAt) >= dayAgo).slice(0, 8);
  $("popular-today").replaceChildren(...today.map(postCard)); if (!today.length) $("popular-today").textContent = "No popular posts in the last 24 hours yet.";
  const topics = topicCounts(posts); $("topic-list").replaceChildren(...topics.slice(0, 24).map(({ tag, count }) => { const link = document.createElement("a"); link.className = "topic-chip"; link.href = `discover.html?topic=${encodeURIComponent(tag)}`; link.textContent = `#${tag} · ${count}`; return link; })); if (!topics.length) $("topic-list").textContent = "Topics will appear as people use hashtags.";
  $("suggested-people").replaceChildren(...suggestedPeople({ users, follows, viewerUid: viewer.uid }).map(personCard));
  $("discover-status").textContent = `Discovering from ${posts.length} recent posts and ${users.length} community profiles.`;
  renderRecentSearches();
};

const runSearch = (raw) => {
  const value = String(raw || "").trim(); const host = $("discover-results"); if (!value) { host.innerHTML = '<p class="ux-muted">Start typing to search the loaded discovery set.</p>'; return; }
  rememberSearch(localStorage, viewer.uid, value); renderRecentSearches(); const needle = value.replace(/^#/, "").toLowerCase();
  const matchedPosts = posts.filter((post) => String(post.content || "").toLowerCase().includes(needle) || extractHashtags(post.content).includes(needle)).slice(0, 12);
  const matchedUsers = users.filter((user) => String(user.username || "").toLowerCase().includes(needle)).slice(0, 8);
  host.replaceChildren(...matchedPosts.map(postCard), ...matchedUsers.map(personCard)); if (!host.children.length) host.textContent = "No matches in the recent discovery set.";
};

const load = async () => {
  const [postSnap, communitySnap, usersSnap, followsSnap] = await Promise.all([
    getDocs(query(collection(db, "posts"), where("moderationState", "==", "visible"), limit(60))),
    getDocs(query(collection(db, "communityPosts"), where("moderationState", "==", "visible"), limit(40))),
    getDocs(query(collection(db, "users"), limit(60))),
    getDocs(query(collection(db, "follows"), limit(200)))
  ]);
  posts = [...postSnap.docs.map((entry) => ({ id: entry.id, collection: "posts", ...entry.data() })), ...communitySnap.docs.map((entry) => ({ id: entry.id, collection: "communityPosts", ...entry.data() }))]
    .filter((post) => !post.expiresAt?.toMillis || post.expiresAt.toMillis() > Date.now())
    .map((post) => ({ ...post, comments: Number(post.commentCount || 0), reactions: sumReactions(post.reactionCounts) }));
  users = usersSnap.docs.map((entry) => ({ uid: entry.id, ...entry.data() })).filter((user) => user.banned !== true);
  follows = followsSnap.docs.map((entry) => entry.data()); render();
};

let searchTimer = 0; $("discover-search")?.addEventListener("input", (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(event.target.value), 180); });
$("clear-searches")?.addEventListener("click", () => { if (!viewer) return; localStorage.removeItem(`anonchat:recent-searches:${viewer.uid}`); renderRecentSearches(); });
onAuthStateChanged(auth, (user) => { if (!user) { location.href = "index.html"; return; } viewer = user; void load().catch(() => { $("discover-status").textContent = "Could not load Discover right now."; }); });
