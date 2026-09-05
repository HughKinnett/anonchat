import { auth, db } from "./firebase-config.js";
import { extractHashtags } from "./discovery-policy.mjs";
import { normalizePostMedia, recordLocalRecentView } from "./user-experience-policy.mjs";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

let viewer = null;
const decoratedPosts = new WeakSet();
const decoratedComments = new WeakSet();
const editCache = new Map();
const mediaCache = new Map();
const recentObserver = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const entry of entries) if (entry.isIntersecting && viewer) {
    const item = entry.target; const text = postTextNode(item)?.textContent?.trim() || "Post";
    recordLocalRecentView(localStorage, viewer.uid, { collection: item.dataset.postCollection || "posts", postId: item.dataset.postId, text: text.slice(0, 220) });
    recentObserver.unobserve(item);
  }
}, { threshold: .6 }) : null;

const keyFor = (collectionName, id) => `${collectionName}__${id}`;
const toast = (text) => { const node = document.createElement("div"); node.className = "ux-toast"; node.textContent = text; document.body.append(node); setTimeout(() => node.remove(), 1500); };
const actionsFor = (item) => item.querySelector(".post-actions");
const postTextNode = (item) => [...item.children].find((node) => node.tagName === "P" && !node.classList.contains("interaction-status") && !node.classList.contains("post-delete-status")) || item.querySelector("p");
const commentTextNode = (item) => item.querySelector("p");

const applyEdit = (node, edit) => {
  if (!node || !edit?.content) return;
  node.textContent = edit.content;
  let label = node.parentElement?.querySelector(":scope > .edited-label");
  if (!label) { label = document.createElement("span"); label.className = "edited-label"; label.textContent = "Edited"; node.after(label); }
};

const loadPostEdit = async (item) => {
  const editKey = keyFor(item.dataset.postCollection || "posts", item.dataset.postId);
  if (!editCache.has(editKey)) {
    try { const snap = await getDoc(doc(db, "contentEdits", editKey)); editCache.set(editKey, snap.exists() ? snap.data() : null); } catch { editCache.set(editKey, null); }
  }
  applyEdit(postTextNode(item), editCache.get(editKey));
};

const savePostEdit = async (item) => {
  if (!viewer || item.dataset.authorId !== viewer.uid) return;
  const current = postTextNode(item)?.textContent?.trim() || "";
  const content = prompt("Edit your post:", current)?.trim();
  if (!content || content === current || content.length > 2000) return;
  const targetCollection = item.dataset.postCollection || "posts"; const targetId = item.dataset.postId;
  const payload = { kind: "post", targetCollection, targetId, ownerId: viewer.uid, content, editedAt: serverTimestamp() };
  await setDoc(doc(db, "contentEdits", keyFor(targetCollection, targetId)), payload);
  editCache.set(keyFor(targetCollection, targetId), { ...payload, editedAt: new Date() }); applyEdit(postTextNode(item), payload); toast("Post edited.");
};

const toggleSaved = async (item, button) => {
  if (!viewer) return;
  const collectionName = item.dataset.postCollection || "posts"; const postId = item.dataset.postId; const key = keyFor(collectionName, postId);
  const ref = doc(db, "savedPosts", viewer.uid, "items", key); const existing = await getDoc(ref);
  if (existing.exists()) { await deleteDoc(ref); button.textContent = "🔖 Save"; toast("Removed from Saved."); return; }
  await setDoc(ref, { ownerId: viewer.uid, targetCollection: collectionName, targetId: postId, authorId: item.dataset.authorId || "", snapshotText: (postTextNode(item)?.textContent || "Post").slice(0, 500), savedAt: serverTimestamp() });
  button.textContent = "🔖 Saved"; toast("Saved.");
};

const updateSaveState = async (item, button) => {
  if (!viewer) return;
  try { const snap = await getDoc(doc(db, "savedPosts", viewer.uid, "items", keyFor(item.dataset.postCollection || "posts", item.dataset.postId))); button.textContent = snap.exists() ? "🔖 Saved" : "🔖 Save"; } catch { button.textContent = "🔖 Save"; }
};

const compressImage = (file) => new Promise((resolve, reject) => {
  if (!file?.type.startsWith("image/") || file.size > 4 * 1024 * 1024) return reject(new Error("Each image must be under 4 MB."));
  const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read image."));
  reader.onload = () => {
    if (file.type === "image/gif") { if (file.size > 300 * 1024) return reject(new Error("Animated GIFs must be under 300 KB.")); resolve(reader.result); return; }
    const image = new Image(); image.onerror = () => reject(new Error("Could not open image."));
    image.onload = () => {
      const scale = Math.min(1, 900 / Math.max(image.width, image.height)); const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL("image/jpeg", .7));
    }; image.src = reader.result;
  }; reader.readAsDataURL(file);
});

const renderMedia = (item, images = []) => {
  let grid = item.querySelector(".post-media-grid");
  if (!images.length) { grid?.remove(); return; }
  if (!grid) { grid = document.createElement("div"); grid.className = "post-media-grid"; const actions = actionsFor(item); item.insertBefore(grid, actions || null); }
  grid.replaceChildren(...images.map((src) => { const img = document.createElement("img"); img.src = src; img.alt = "Post gallery image"; img.loading = "lazy"; return img; }));
};

const loadMedia = async (item) => {
  const key = keyFor(item.dataset.postCollection || "posts", item.dataset.postId);
  if (!mediaCache.has(key)) { try { const snap = await getDoc(doc(db, "postMedia", key)); mediaCache.set(key, snap.exists() ? normalizePostMedia(snap.data().images) : []); } catch { mediaCache.set(key, []); } }
  renderMedia(item, mediaCache.get(key));
};

const addMedia = async (item) => {
  if (!viewer || item.dataset.authorId !== viewer.uid) return;
  const input = document.createElement("input"); input.type = "file"; input.accept = "image/*"; input.multiple = true;
  input.onchange = async () => {
    try {
      const selected = [...input.files].slice(0, 4); const images = normalizePostMedia(await Promise.all(selected.map(compressImage)));
      if (!images.length) return;
      const key = keyFor(item.dataset.postCollection || "posts", item.dataset.postId); const payload = { ownerId: viewer.uid, targetCollection: item.dataset.postCollection || "posts", targetId: item.dataset.postId, images, updatedAt: serverTimestamp() };
      await setDoc(doc(db, "postMedia", key), payload); mediaCache.set(key, images); renderMedia(item, images); toast("Photo gallery saved.");
    } catch (error) { toast(error.message || "Could not add photos."); }
  }; input.click();
};

const renderTopics = (item) => {
  const tags = extractHashtags(postTextNode(item)?.textContent || ""); if (!tags.length || item.querySelector(".post-topic-links")) return;
  const host = document.createElement("div"); host.className = "post-topic-links";
  tags.forEach((tag) => { const link = document.createElement("a"); link.className = "topic-chip"; link.href = `discover.html?topic=${encodeURIComponent(tag)}`; link.textContent = `#${tag}`; host.append(link); });
  const actions = actionsFor(item); item.insertBefore(host, actions || null);
};

const decoratePost = (item) => {
  if (decoratedPosts.has(item) || !item.dataset.postId) return; decoratedPosts.add(item);
  const actions = actionsFor(item); if (!actions) { decoratedPosts.delete(item); return; }
  const copy = document.createElement("button"); copy.type = "button"; copy.className = "ux-small-button"; copy.textContent = "📋 Copy"; copy.onclick = async () => { await navigator.clipboard?.writeText?.(postTextNode(item)?.textContent || ""); toast("Post text copied."); };
  const save = document.createElement("button"); save.type = "button"; save.className = "ux-small-button"; save.textContent = "🔖 Save"; save.onclick = () => void toggleSaved(item, save).catch(() => toast("Could not update Saved."));
  actions.append(copy, save); void updateSaveState(item, save);
  if (viewer && item.dataset.authorId === viewer.uid) {
    const edit = document.createElement("button"); edit.type = "button"; edit.className = "ux-small-button"; edit.textContent = "✏️ Edit"; edit.onclick = () => void savePostEdit(item).catch(() => toast("Could not edit post."));
    const media = document.createElement("button"); media.type = "button"; media.className = "ux-small-button"; media.textContent = "🖼️ Photos/GIF"; media.onclick = () => void addMedia(item);
    actions.append(edit, media);
  }
  renderTopics(item); void loadPostEdit(item); void loadMedia(item); recentObserver?.observe(item);
};

const commentContext = (commentItem) => {
  const post = commentItem.closest(".feed-item");
  return post ? { post, targetCollection: post.dataset.postCollection || "posts", postId: post.dataset.postId, commentId: commentItem.dataset.commentId } : null;
};
const commentEditKey = (context) => `${context.targetCollection}__${context.postId}__comment__${context.commentId}`;

const loadCommentEdit = async (commentItem) => {
  const context = commentContext(commentItem); if (!context?.commentId) return; const key = commentEditKey(context);
  if (!editCache.has(key)) { try { const snap = await getDoc(doc(db, "contentEdits", key)); editCache.set(key, snap.exists() ? snap.data() : null); } catch { editCache.set(key, null); } }
  applyEdit(commentTextNode(commentItem), editCache.get(key));
};

const editComment = async (commentItem) => {
  const context = commentContext(commentItem); if (!context || commentItem.dataset.commentUid !== viewer?.uid) return;
  const current = commentTextNode(commentItem)?.textContent?.trim() || ""; const content = prompt("Edit your comment:", current)?.trim(); if (!content || content === current || content.length > 1000) return;
  const payload = { kind: "comment", targetCollection: context.targetCollection, postId: context.postId, commentId: context.commentId, ownerId: viewer.uid, content, editedAt: serverTimestamp() };
  await setDoc(doc(db, "contentEdits", commentEditKey(context)), payload); editCache.set(commentEditKey(context), payload); applyEdit(commentTextNode(commentItem), payload); toast("Comment edited.");
};

const loadReplies = async (commentItem, button) => {
  const context = commentContext(commentItem); if (!context) return; const parentKey = `${context.targetCollection}__${context.postId}__${context.commentId}`;
  let host = commentItem.querySelector(".comment-replies"); if (!host) { host = document.createElement("div"); host.className = "comment-replies"; commentItem.append(host); }
  try {
    const snapshot = await getDocs(query(collection(db, "commentReplies"), where("parentKey", "==", parentKey), limit(50)));
    const replies = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    host.replaceChildren(...replies.map((reply) => { const row = document.createElement("div"); row.className = "comment-reply-item"; const who = document.createElement("strong"); who.textContent = `@${reply.username || "anonymous"}`; const text = document.createElement("p"); text.textContent = reply.text || ""; row.append(who, text); return row; }));
    button.textContent = replies.length ? `Replies (${replies.length})` : "Replies";
  } catch { toast("Could not load replies."); }
};

const replyToComment = async (commentItem) => {
  const context = commentContext(commentItem); if (!context || !viewer) return; const text = prompt("Reply to this comment:")?.trim(); if (!text || text.length > 1000) return;
  const profile = await getDoc(doc(db, "users", viewer.uid)); const username = profile.exists() ? profile.data().username : "anonymous";
  await addDoc(collection(db, "commentReplies"), { parentKey: `${context.targetCollection}__${context.postId}__${context.commentId}`, targetCollection: context.targetCollection, postId: context.postId, parentCommentId: context.commentId, uid: viewer.uid, username, text, moderationState: "visible", createdAt: serverTimestamp() });
  const button = commentItem.querySelector(".load-replies-button"); if (button) await loadReplies(commentItem, button); toast("Reply posted.");
};

const decorateComment = (item) => {
  if (decoratedComments.has(item) || !item.dataset.commentId) return; decoratedComments.add(item);
  const actions = document.createElement("div"); actions.className = "ux-actions comment-extra-actions";
  const reply = document.createElement("button"); reply.type = "button"; reply.className = "ux-small-button"; reply.textContent = "↩ Reply"; reply.onclick = () => void replyToComment(item).catch(() => toast("Could not post reply."));
  const load = document.createElement("button"); load.type = "button"; load.className = "ux-small-button load-replies-button"; load.textContent = "Replies"; load.onclick = () => void loadReplies(item, load);
  actions.append(reply, load);
  if (viewer && item.dataset.commentUid === viewer.uid) { const edit = document.createElement("button"); edit.type = "button"; edit.className = "ux-small-button"; edit.textContent = "✏️ Edit"; edit.onclick = () => void editComment(item).catch(() => toast("Could not edit comment.")); actions.append(edit); }
  item.append(actions); void loadCommentEdit(item);
};

const decorateAll = () => {
  document.querySelectorAll(".feed-item[data-post-id]").forEach(decoratePost);
  document.querySelectorAll(".comment-item[data-comment-id]").forEach(decorateComment);
};
const observer = new MutationObserver(() => queueMicrotask(decorateAll)); observer.observe(document.documentElement, { childList: true, subtree: true });
onAuthStateChanged(auth, (user) => { viewer = user; decorateAll(); });
