import { auth, db } from "./firebase-config.js";
import {
  getCommunity,
  joinCommunity,
  listCommunityBadgeTypes,
  listCommunityMemberBadges,
  listCommunityMembers,
  listCommunityPosts,
  removeCommunityMemberBadge,
  saveCommunityBadgeType,
  setCommunityMemberBadge,
  setCommunityModerator,
  setCommunityPostPinned
} from "./community-interest-firestore.mjs";
import { canonicalPollVote, pollVoteDocumentId } from "./poll-vote-policy.mjs";
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
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
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
const postKindSelect = document.getElementById("community-post-kind");
const pollOptionsPanel = document.getElementById("community-poll-options");
const pollOptionInputs = [...document.querySelectorAll("[data-community-poll-option]")];
const postsList = document.getElementById("community-posts-list");
const signOutButton = document.getElementById("community-detail-sign-out");

let currentUser = null;
let currentUsername = "anonymous";
let currentCommunity = null;
let currentMembership = null;
let communityMembers = [];
let communityBadgeTypes = [];
let communityBadgesByMember = new Map();
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
    return !(await moderation?.isPairBlocked(uid));
  } catch {
    return false;
  }
};

const canModerate = () => currentMembership?.role === "owner" || currentMembership?.role === "moderator";

const badgeTypeFor = (badgeId) => communityBadgeTypes.find((badge) => badge.id === badgeId);
const memberBadgeNames = (uid) => (communityBadgesByMember.get(uid) || [])
  .map((assignment) => badgeTypeFor(assignment.badgeId)?.name)
  .filter(Boolean);

const refreshCommunityBadges = async () => {
  communityBadgeTypes = await listCommunityBadgeTypes(db, communityId);
  communityBadgesByMember = new Map();
  await Promise.all(communityMembers.map(async (member) => {
    const uid = member.uid || member.id;
    communityBadgesByMember.set(uid, await listCommunityMemberBadges(db, communityId, uid));
  }));
};

const badgeIdFromName = (name) => String(name || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 40);

const renderBadgeControls = async () => {
  document.getElementById("community-badge-controls")?.remove();
  if (!canModerate()) return;

  const panel = document.createElement("section");
  panel.id = "community-badge-controls";
  panel.className = "connections-panel";
  const heading = document.createElement("h2");
  heading.textContent = "Community badges";
  const note = document.createElement("p");
  note.textContent = "These labels apply only inside this Community and do not grant site-wide privileges.";
  panel.append(heading, note);

  const form = document.createElement("form");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.placeholder = "Badge name";
  nameInput.required = true;
  const descriptionInput = document.createElement("input");
  descriptionInput.type = "text";
  descriptionInput.maxLength = 160;
  descriptionInput.placeholder = "Badge description";
  const save = document.createElement("button");
  save.type = "submit";
  save.textContent = "Save badge";
  form.append(nameInput, descriptionInput, save);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const badgeId = badgeIdFromName(nameInput.value);
    if (!badgeId) return;
    save.disabled = true;
    try {
      await saveCommunityBadgeType(db, communityId, currentUser.uid, badgeId, {
        name: nameInput.value,
        description: descriptionInput.value,
        active: true
      });
      nameInput.value = "";
      descriptionInput.value = "";
      await refreshCommunityBadges();
      await renderBadgeControls();
      await renderPosts();
    } catch (error) {
      setStatus(error?.message || "Could not save Community badge.");
      save.disabled = false;
    }
  });
  panel.append(form);

  for (const member of communityMembers) {
    const uid = member.uid || member.id;
    const row = document.createElement("div");
    row.className = "connection-card";
    const username = await profileLabel(uid);
    const assigned = communityBadgesByMember.get(uid) || [];
    const assignedNames = memberBadgeNames(uid);
    const label = document.createElement("span");
    label.textContent = `@${username}${assignedNames.length ? ` · ${assignedNames.join(", ")}` : ""}`;
    row.append(label);

    const select = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose badge";
    select.append(placeholder);
    for (const badge of communityBadgeTypes) {
      if (assigned.some((entry) => entry.badgeId === badge.id)) continue;
      const option = document.createElement("option");
      option.value = badge.id;
      option.textContent = badge.name;
      select.append(option);
    }
    const assign = document.createElement("button");
    assign.type = "button";
    assign.textContent = "Assign";
    assign.addEventListener("click", async () => {
      if (!select.value) return;
      assign.disabled = true;
      try {
        await setCommunityMemberBadge(db, communityId, currentUser.uid, uid, select.value);
        await refreshCommunityBadges();
        await renderBadgeControls();
        await renderPosts();
      } catch (error) {
        setStatus(error?.message || "Could not assign Community badge.");
        assign.disabled = false;
      }
    });
    row.append(select, assign);

    for (const assignment of assigned) {
      const badge = badgeTypeFor(assignment.badgeId);
      if (!badge) continue;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = `Remove ${badge.name}`;
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await removeCommunityMemberBadge(db, communityId, currentUser.uid, uid, assignment.badgeId);
          await refreshCommunityBadges();
          await renderBadgeControls();
          await renderPosts();
        } catch (error) {
          setStatus(error?.message || "Could not remove Community badge.");
          remove.disabled = false;
        }
      });
      row.append(remove);
    }
    panel.append(row);
  }

  document.getElementById("community-staff-controls")?.after(panel);
  if (!document.getElementById("community-staff-controls")) composer?.parentElement?.after(panel);
};

const renderMemberControls = async () => {
  let panel = document.getElementById("community-staff-controls");
  panel?.remove();
  if (currentMembership?.role !== "owner") return;

  panel = document.createElement("section");
  panel.id = "community-staff-controls";
  panel.className = "connections-panel";
  const heading = document.createElement("h2");
  heading.textContent = "Community staff";
  panel.append(heading);

  for (const member of communityMembers) {
    const row = document.createElement("div");
    row.className = "connection-card";
    const label = document.createElement("span");
    const username = await profileLabel(member.uid || member.id);
    const roleLabel = member.role === "owner" ? "Owner" : member.role === "moderator" ? "Moderator" : "Member";
    label.textContent = `@${username} · ${roleLabel}`;
    row.append(label);

    if (member.role === "owner") {
      const protectedLabel = document.createElement("span");
      protectedLabel.textContent = "Owner role cannot be removed here.";
      row.append(protectedLabel);
    } else {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = member.role === "moderator" ? "Remove moderator" : "Make moderator";
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          await setCommunityModerator(db, communityId, currentUser.uid, member.uid || member.id, member.role !== "moderator");
          communityMembers = await listCommunityMembers(db, communityId);
          currentMembership = communityMembers.find((entry) => entry.uid === currentUser.uid || entry.id === currentUser.uid) || null;
          await refreshCommunityBadges();
          await renderMemberControls();
          await renderBadgeControls();
          await renderPosts();
        } catch (error) {
          setStatus(error?.message || "Could not update moderator role.");
          toggle.disabled = false;
        }
      });
      row.append(toggle);
    }
    panel.append(row);
  }

  composer?.parentElement?.after(panel);
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

const communityPollVotes = async (post) => {
  const snapshot = await getDocs(query(
    collection(db, "communityVotes"),
    where("postCollection", "==", "communityPosts"),
    where("postId", "==", post.id)
  ));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
};

const voteOnPoll = async (post, option) => {
  const voteRef = doc(db, "communityVotes", pollVoteDocumentId("communityPosts", post.id, currentUser.uid));
  await setDoc(voteRef, canonicalPollVote({
    postCollection: "communityPosts",
    postId: post.id,
    uid: currentUser.uid,
    option,
    createdAt: serverTimestamp()
  }));
};

const renderPoll = async (post) => {
  const wrapper = document.createElement("div");
  wrapper.className = "community-poll";
  const votes = await communityPollVotes(post);
  const options = Array.isArray(post.options) ? post.options.slice(0, 4) : [];
  options.forEach((label, index) => {
    const button = document.createElement("button");
    button.type = "button";
    const count = votes.filter((vote) => vote.option === index).length;
    const selected = votes.some((vote) => vote.uid === currentUser.uid && vote.option === index);
    button.textContent = `${label} · ${count}${selected ? " · Your vote" : ""}`;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await voteOnPoll(post, index);
        await renderPosts();
      } catch (error) {
        setStatus(error?.message || "Could not save your vote.");
        button.disabled = false;
      }
    });
    wrapper.append(button);
  });
  return wrapper;
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
    const authorMembership = communityMembers.find((member) => member.uid === post.authorId || member.id === post.authorId);
    const staffBadge = authorMembership?.role === "owner" ? " · Owner" : authorMembership?.role === "moderator" ? " · Moderator" : "";
    const scopedBadges = memberBadgeNames(post.authorId);
    const scopedBadgeLabel = scopedBadges.length ? ` · ${scopedBadges.join(" · ")}` : "";
    author.textContent = `@${authorLabel}${staffBadge}${scopedBadgeLabel}${post.pinnedAt ? " · Pinned" : ""}`;

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

    actions.append(like, report);

    if (canModerate()) {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = post.pinnedAt ? "Unpin" : "Pin";
      pin.addEventListener("click", async () => {
        pin.disabled = true;
        try {
          await setCommunityPostPinned(db, communityId, post.id, currentUser.uid, !post.pinnedAt);
          await renderPosts();
        } catch (error) {
          setStatus(error?.message || "Could not update pin.");
          pin.disabled = false;
        }
      });
      actions.append(pin);
    }

    const reactionSummary = document.createElement("span");
    await loadReactions(post.id, reactionSummary);
    actions.append(reactionSummary);

    card.append(author, body);
    if (post.category === "Poll" && Array.isArray(post.options) && post.options.length >= 2) {
      card.append(await renderPoll(post));
    }
    card.append(actions);

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

    card.append(comments, commentForm);
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

  communityMembers = await listCommunityMembers(db, communityId);
  currentMembership = communityMembers.find((member) => member.uid === currentUser.uid || member.id === currentUser.uid) || null;
  composer.hidden = !currentMembership;
  if (!currentMembership) setStatus("Join this Community from Discover before posting.");

  await refreshCommunityBadges();
  await renderMemberControls();
  await renderBadgeControls();
  await renderPosts();
};

postKindSelect?.addEventListener("change", () => {
  if (pollOptionsPanel) pollOptionsPanel.hidden = postKindSelect.value !== "Poll";
});

composer?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentMembership) return;
  const content = String(composerText?.value || "").trim().slice(0, 500);
  if (!content) return;
  const postKind = postKindSelect?.value === "Poll" ? "Poll" : "Question";
  const options = postKind === "Poll"
    ? pollOptionInputs.map((input) => String(input.value || "").trim().slice(0, 120)).filter(Boolean)
    : [];
  if (postKind === "Poll" && (options.length < 2 || options.length > 4)) {
    setStatus("Polls need between 2 and 4 options.");
    return;
  }
  try {
    await addDoc(collection(db, "communityPosts"), {
      authorId: currentUser.uid,
      username: currentUsername,
      content,
      category: postKind === "Poll" ? "Poll" : "Question",
      communityId,
      options,
      moderationState: "visible",
      createdAt: serverTimestamp()
    });
    composerText.value = "";
    pollOptionInputs.forEach((input) => { input.value = ""; });
    if (postKindSelect) postKindSelect.value = "Question";
    if (pollOptionsPanel) pollOptionsPanel.hidden = true;
    setStatus("");
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
