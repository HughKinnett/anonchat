import { auth, db } from "./firebase-config.js";
import {
  getGroup,
  joinPublicGroup,
  leaveGroup,
  listGroupMembers,
  listGroupPosts,
  removeGroupMember,
  setGroupModerator,
  setGroupPostPinned
} from "./group-firestore.mjs";
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
const groupId = params.get("id") || "";
const title = document.getElementById("group-detail-title");
const description = document.getElementById("group-detail-description");
const membersLabel = document.getElementById("group-detail-members");
const roleLabel = document.getElementById("group-detail-role");
const membershipButton = document.getElementById("group-detail-membership");
const status = document.getElementById("group-detail-status");
const composer = document.getElementById("group-post-composer");
const composerText = document.getElementById("group-post-content");
const postKindSelect = document.getElementById("group-post-kind");
const pollOptionsPanel = document.getElementById("group-poll-options");
const pollOptionInputs = [...document.querySelectorAll("[data-group-poll-option]")];
const postsList = document.getElementById("group-posts-list");
const signOutButton = document.getElementById("group-detail-sign-out");

let currentUser = null;
let currentUsername = "anonymous";
let currentGroup = null;
let currentMembership = null;
let groupMembers = [];
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

const refreshMembership = async () => {
  groupMembers = await listGroupMembers(db, groupId);
  currentMembership = groupMembers.find((member) => member.uid === currentUser?.uid || member.id === currentUser?.uid) || null;
  if (roleLabel) roleLabel.textContent = currentMembership ? `Your role: ${currentMembership.role}` : "You are not a member yet.";
  if (composer) composer.hidden = !currentMembership;
  if (membershipButton) {
    membershipButton.hidden = currentGroup?.visibility !== "public";
    membershipButton.disabled = currentMembership?.role === "owner";
    membershipButton.textContent = currentMembership ? "Leave Group" : "Join Group";
  }
};

const renderStaffControls = async () => {
  document.getElementById("group-staff-controls")?.remove();
  if (!currentMembership) return;

  const panel = document.createElement("section");
  panel.id = "group-staff-controls";
  panel.className = "connections-panel";

  const heading = document.createElement("h2");
  heading.textContent = "Group members";
  panel.append(heading);

  for (const member of groupMembers) {
    const uid = member.uid || member.id;
    const row = document.createElement("div");
    row.className = "connection-card";

    const roleName = member.role === "owner" ? "Owner" : member.role === "moderator" ? "Moderator" : "Member";
    const label = document.createElement("span");
    label.textContent = `@${await profileLabel(uid)} · ${roleName}`;
    row.append(label);

    if (member.role === "owner") {
      const protectedLabel = document.createElement("span");
      protectedLabel.textContent = "Owner role cannot be removed.";
      row.append(protectedLabel);
    } else {
      if (currentMembership?.role === "owner") {
        const moderatorToggle = document.createElement("button");
        moderatorToggle.type = "button";
        moderatorToggle.textContent = member.role === "moderator" ? "Remove moderator" : "Make moderator";
        moderatorToggle.addEventListener("click", async () => {
          moderatorToggle.disabled = true;
          try {
            await setGroupModerator(db, groupId, currentUser.uid, uid, member.role !== "moderator");
            await refreshMembership();
            await renderStaffControls();
            await renderPosts();
          } catch (error) {
            setStatus(error?.message || "Could not update moderator role.");
            moderatorToggle.disabled = false;
          }
        });
        row.append(moderatorToggle);
      }

      const canRemove = currentMembership?.role === "owner"
        || (currentMembership?.role === "moderator" && member.role === "member");
      if (canRemove && uid !== currentUser.uid) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove member";
        remove.addEventListener("click", async () => {
          remove.disabled = true;
          try {
            await removeGroupMember(db, groupId, currentUser.uid, uid);
            currentGroup = await getGroup(db, groupId);
            if (membersLabel) membersLabel.textContent = `${Number(currentGroup?.memberCount || 0)} members`;
            await refreshMembership();
            await renderStaffControls();
            await renderPosts();
          } catch (error) {
            setStatus(error?.message || "Could not remove Group member.");
            remove.disabled = false;
          }
        });
        row.append(remove);
      }
    }

    panel.append(row);
  }

  composer?.parentElement?.after(panel);
};

const loadComments = async (postId, container) => {
  const snapshot = await getDocs(collection(db, "communityPosts", postId, "comments"));
  const comments = [...snapshot.docs].sort((a, b) => Number(a.data().createdAt?.toMillis?.() || 0) - Number(b.data().createdAt?.toMillis?.() || 0));
  for (const entry of comments) {
    const data = entry.data();
    if (!(await canShowAuthor(data.uid))) continue;
    const row = document.createElement("p");
    row.textContent = `@${await profileLabel(data.uid)}: ${data.text || ""}`;
    container.append(row);
  }
};

const loadReactions = async (postId, container) => {
  const snapshot = await getDocs(collection(db, "communityPosts", postId, "reactions"));
  let count = 0;
  for (const reaction of snapshot.docs) {
    if (await canShowAuthor(reaction.data().uid)) count += 1;
  }
  const summary = document.createElement("span");
  summary.textContent = `${count} reactions`;
  container.append(summary);
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

const groupPollVotes = async (post) => {
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
  const votes = await groupPollVotes(post);
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

const deleteOwnPost = async (post) => {
  if (post.authorId !== currentUser.uid) return;
  if (!window.confirm("Delete this post?")) return;
  await deleteDoc(doc(db, "communityPosts", post.id));
};

const renderPosts = async () => {
  if (!postsList) return;
  postsList.replaceChildren();
  const posts = await listGroupPosts(db, groupId);
  if (!posts.length) {
    const empty = document.createElement("p");
    empty.textContent = "No posts yet. Start the discussion.";
    postsList.append(empty);
    return;
  }

  for (const post of posts) {
    if (!(await canShowAuthor(post.authorId))) continue;
    const card = document.createElement("article");
    card.className = "post-card";
    card.dataset.postId = post.id;

    const author = document.createElement("p");
    const member = groupMembers.find((entry) => entry.uid === post.authorId || entry.id === post.authorId);
    const staff = member?.role === "owner" ? " · Owner" : member?.role === "moderator" ? " · Moderator" : "";
    author.textContent = `@${await profileLabel(post.authorId)}${staff}${post.pinnedAt ? " · Pinned" : ""}`;

    const body = document.createElement("p");
    body.textContent = post.content || "";
    card.append(author, body);

    if (post.category === "Poll" && Array.isArray(post.options) && post.options.length >= 2) {
      card.append(await renderPoll(post));
    }

    const actions = document.createElement("div");
    actions.className = "post-actions";

    const like = document.createElement("button");
    like.type = "button";
    like.textContent = "Like";
    like.addEventListener("click", async () => {
      await toggleLike(post.id);
      await renderPosts();
    });
    actions.append(like);

    if (post.authorId === currentUser.uid) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        try {
          await deleteOwnPost(post);
          await renderPosts();
        } catch (error) {
          setStatus(error?.message || "Could not delete post.");
        }
      });
      actions.append(remove);
    } else {
      const report = document.createElement("button");
      report.type = "button";
      report.className = REPORT_BUTTON_CLASS;
      report.textContent = "Report";
      report.addEventListener("click", async () => {
        try { await reportPost(post); } catch (error) { setStatus(error?.message || "Could not submit report."); }
      });
      actions.append(report);
    }

    if (canModerate()) {
      const pin = document.createElement("button");
      pin.type = "button";
      pin.textContent = post.pinnedAt ? "Unpin" : "Pin";
      pin.addEventListener("click", async () => {
        pin.disabled = true;
        try {
          await setGroupPostPinned(db, groupId, post.id, currentUser.uid, !post.pinnedAt);
          await renderPosts();
        } catch (error) {
          setStatus(error?.message || "Could not update pin.");
          pin.disabled = false;
        }
      });
      actions.append(pin);
    }

    await loadReactions(post.id, actions);
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

const loadGroup = async () => {
  if (!groupId) throw new Error("Group not found.");
  currentGroup = await getGroup(db, groupId);
  if (!currentGroup) throw new Error("Group not found.");
  if (title) title.textContent = currentGroup.name || "Group";
  if (description) description.textContent = currentGroup.description || "";
  if (membersLabel) membersLabel.textContent = `${Number(currentGroup.memberCount || 0)} members`;
  await refreshMembership();
  await renderStaffControls();
  await renderPosts();
};

membershipButton?.addEventListener("click", async () => {
  if (!currentUser || currentGroup?.visibility !== "public") return;
  membershipButton.disabled = true;
  try {
    if (currentMembership) await leaveGroup(db, groupId, currentUser.uid);
    else await joinPublicGroup(db, groupId, currentUser.uid);
    currentGroup = await getGroup(db, groupId);
    if (membersLabel) membersLabel.textContent = `${Number(currentGroup?.memberCount || 0)} members`;
    await refreshMembership();
    await renderStaffControls();
    await renderPosts();
  } catch (error) {
    setStatus(error?.message || "Could not update Group membership.");
    membershipButton.disabled = false;
  }
});

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
      groupId,
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
    setStatus(error?.message || "Could not create Group post.");
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
    await loadGroup();
  } catch (error) {
    setStatus(error?.message || "Could not load Group.");
    if (composer) composer.hidden = true;
  }
});
