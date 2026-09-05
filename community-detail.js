import { auth, db } from "./firebase-config.js";
import {
  getCommunity,
  joinCommunity,
  listCommunityMembers,
  listCommunityPosts
} from "./community-interest-firestore.mjs";
import { createModerationClient } from "./moderation-client.mjs";
import { REPORT_BUTTON_CLASS, REPORT_REASONS } from "./moderation-policy.mjs";
import { exitAfterAuthLoss, exitAuthenticatedSession } from "./push-exit.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const params = new URLSearchParams(location.search);
const communityId = params.get("id") || "";
const title = document.getElementById("community-detail-title");
const description = document.getElementById("community-detail-description");
const membersLabel = document.getElementById("community-detail-members");
const rulesList = document.getElementById("community-detail-rules");
const status = document.getElementById("community-detail-status");
const composer = document.getElementById("community-post-composer");
const composerText = document.getElementById("community-post-content");
const postsList = document.getElementById("community-posts-list");
const signOutButton = document.getElementById("community-detail-sign-out");

let currentUser = null;
let currentUsername = "anonymous";
let currentCommunity = null;
let currentMembership = null;
let moderation = null;

const setStatus = (message = "") => {
  if (status) status.textContent = message;
};

const profileLabel = async (uid) => {
  if (!uid) return "deleted";
  try {
    const snapshot = await getDoc(doc(db, "users", uid));
    if (!snapshot.exists()) return "deleted";
    return snapshot.data().username || "anonymous";
  } catch {
    return "anonymous";
  }
};

const canShowAuthor = async (uid) => {
  if (!uid || uid === currentUser?.uid) return true;
  try {
    // Uses the same blocked-pair semantics as viewer-block-policy for the viewer's readable direction.
    return !(await moderation?.isPairBlocked(uid));
  } catch {
    return false;
  }
};

const loadComments = async (postId, container) => {
  const snapshot = await getDocs(collection(db, "communityPosts", postId, "comments"));
  const comments = [...snapshot.docs].sort((a, b) => Number(a.data().createdAt?.toMillis?.() || 0) - Number(b.data().createdAt?.toMillis?.() || 0));
  for (const comment of comments) {
    const data = comment.data();
    if (!(await canShowAuthor(data.uid))) continue;
    const row = document.createElement("p");
    const label = await profileLabel(data.uid);
    row.textContent = `@${label}: ${data.text || ""}`;
    container.append(row);
  }
};

const loadReactions = async (postId, container) => {
  const snapshot = await getDocs(collection(db, "communityPosts", postId, "reactions"));
  const visible = [];
  for (const reaction of snapshot.docs) {
    if (await canShowAuthor(reaction.data().uid)) visible.push(reaction);
  }
  const count = document.createElement("span");
  count.textContent = `${visible.length} reactions`;
  container.append(count);
};

const toggleLike = async (postId) => {
  const reactionRef = doc(db, "communityPosts", postId, "reactions", currentUser.uid);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(reactionRef);
    if (existing.exists() && existing.data().type === "like") transaction.delete(reactionRef);
    else transaction.set(reactionRef, { uid: currentUser.uid, type: "like", createdAt: serverTimestamp() });
  });
};

const submitComment = async (postId, text) => {
  const commentText = String(text || "").trim().slice(0, 500);
  if (!commentText) return;
  await addDoc(collection(db, "communityPosts", postId, "comments"), {
    uid: currentUser.uid,
    username: currentUsername,
    text: commentText,
    createdAt: serverTimestamp()
  });
};

const reportPost = async (post) => {
  if (!moderation || post.authorId === currentUser.uid) return;
  const reason = window.prompt(`Report reason: ${REPORT_REASONS.join(", ")}`, "other");
  if (!reason) return;
  await moderation.report({
    targetKind: "communityPost",
    targetCollection: "communityPosts",
    targetId: post.id,
    reportedUserId: post.authorId
  }, reason);
  setStatus("Report submitted for moderator review.");
};

const renderPosts = async () => {
  if (!postsList) return;
  postsList.replaceChildren();
  const posts = await listCommunityPosts(db, communityId);
  if (!posts.length) {
    const empty = document.createElement("p");
    empty.textContent = "No posts yet. Start the conversation.";
    postsList.append(empty);
    return;
  }

  for (const post of posts) {
    if (!(await canShowAuthor(post.authorId))) continue;
    const card = document.createElement("article");
    card.className = "post-card";
    card.dataset.postId = post.id;

    const author = document.createElement("p");
    const authorLabel = await profileLabel(post.authorId);
    author.textContent = `@${authorLabel}${post.pinnedAt ? " · Pinned" : ""}`;

    const body = document.createElement("p");
    body.textContent = post.content || "";

    const actions = document.createElement("div");
    actions.className = "post-actions";

    const like = document.createElement("button");
    like.type = "button";
    like.textContent = "Like";
    like.addEventListener("click", async () => {
      await toggleLike(post.id);
      await renderPosts();
    });

    const report = document.createElement("button");
    report.type = "button";
    report.className = REPORT_BUTTON_CLASS;
    report.textContent = "Report";
    report.hidden = post.authorId === currentUser.uid;
    report.addEventListener("click", async () => {
      try { await reportPost(post); } catch (error) { setStatus(error?.message || "Could not submit report."); }
    });

    const reactionSummary = document.createElement("span");
    await loadReactions(post.id, reactionSummary);
    actions.append(like, report, reactionSummary);

    const comments = document.createElement("div");
    comments.className = "post-comments";
    await loadComments(post.id, comments);

    const commentForm = document.createElement("form");
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 500;
    input.placeholder = "Write a comment";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.textContent = "Comment";
    commentForm.append(input, submit);
    commentForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await submitComment(post.id, input.value);
        input.value = "";
        await renderPosts();
      } catch (error) {
        setStatus(error?.message || "Could not add comment.");
      }
    });

    card.append(author, body, actions, comments, commentForm);
    postsList.append(card);
  }
};

const loadCommunity = async () => {
  if (!communityId) throw new Error("Community not found.");
  currentCommunity = await getCommunity(db, communityId);
  if (!currentCommunity) throw new Error("Community not found.");

  title.textContent = currentCommunity.name || "Community";
  description.textContent = currentCommunity.description || "";
  membersLabel.textContent = `${Number(currentCommunity.memberCount || 0)} members`;
  rulesList.replaceChildren();
  for (const rule of currentCommunity.rules || []) {
    const item = document.createElement("li");
    item.textContent = rule;
    rulesList.append(item);
  }

  const members = await listCommunityMembers(db, communityId);
  currentMembership = members.find((member) => member.uid === currentUser.uid || member.id === currentUser.uid) || null;
  composer.hidden = !currentMembership;
  if (!currentMembership) setStatus("Join this Community from Discover before posting.");

  await renderPosts();
};

composer?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentMembership) return;
  const content = String(composerText?.value || "").trim().slice(0, 500);
  if (!content) return;
  try {
    await addDoc(collection(db, "communityPosts"), {
      authorId: currentUser.uid,
      username: currentUsername,
      content,
      category: "Question",
      communityId,
      options: [],
      moderationState: "visible",
      createdAt: serverTimestamp()
    });
    composerText.value = "";
    await renderPosts();
  } catch (error) {
    setStatus(error?.message || "Could not create Community post.");
  }
});

signOutButton?.addEventListener("click", async () => {
  moderation?.destroy?.();
  await exitAuthenticatedSession({ user: currentUser });
  location.href = "index.html";
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    moderation?.destroy?.();
    await exitAfterAuthLoss();
    location.href = "index.html";
    return;
  }
  currentUser = user;
  const profile = await getDoc(doc(db, "users", user.uid));
  currentUsername = profile.exists() ? String(profile.data().username || "anonymous") : "anonymous";
  moderation = createModerationClient({
    db,
    firestore: { deleteDoc, doc, getDoc, setDoc, writeBatch },
    currentUid: user.uid,
    timestamp: serverTimestamp
  });
  try {
    await loadCommunity();
  } catch (error) {
    setStatus(error?.message || "Could not load Community.");
    if (composer) composer.hidden = true;
  }
});
