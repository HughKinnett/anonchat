import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  canManageGroup,
  canModerateGroup,
  canSelfJoinGroup,
  normalizeGroup,
  sortGroupPosts
} from "./group-policy.mjs";

const groupRef = (db, groupId) => doc(db, "groups", groupId);
const memberRef = (db, groupId, uid) => doc(db, "groups", groupId, "members", uid);
const fromSnapshot = (entry) => ({ id: entry.id, ...entry.data() });

export const listPublicGroups = async (db) => {
  const snapshot = await getDocs(collection(db, "groups"));
  return snapshot.docs
    .map(fromSnapshot)
    .filter((group) => group.visibility === "public" && group.status !== "archived")
    .sort((left, right) => Number(right.createdAt?.toMillis?.() ?? 0) - Number(left.createdAt?.toMillis?.() ?? 0));
};

export const getGroup = async (db, groupId) => {
  if (!groupId) return null;
  const snapshot = await getDoc(groupRef(db, groupId));
  return snapshot.exists() ? fromSnapshot(snapshot) : null;
};

export const createPublicGroup = async (db, ownerUid, input = {}) => {
  const uid = String(ownerUid || "").trim();
  if (!uid) throw new Error("A signed-in owner is required.");
  const normalized = normalizeGroup({ ...input, visibility: "public" });
  if (!normalized.name || !normalized.slug) throw new Error("Group name must be at least 3 characters.");
  if (!normalized.topic) throw new Error("Choose a Group topic.");

  const ref = doc(collection(db, "groups"));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...normalized,
    ownerId: uid,
    visibility: "public",
    premiumRequired: false,
    memberCount: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(memberRef(db, ref.id, uid), {
    uid,
    role: "owner",
    joinedAt: serverTimestamp()
  });
  await batch.commit();
  return ref.id;
};

export const joinPublicGroup = async (db, groupId, uid) => {
  const userId = String(uid || "").trim();
  if (!groupId || !userId) throw new Error("Group and user are required.");
  return runTransaction(db, async (transaction) => {
    const group = await transaction.get(groupRef(db, groupId));
    if (!group.exists() || !canSelfJoinGroup(group.data())) throw new Error("That Group is not available for public joining.");
    const target = memberRef(db, groupId, userId);
    const existing = await transaction.get(target);
    if (existing.exists()) return existing.data().role || "member";
    transaction.set(target, { uid: userId, role: "member", joinedAt: serverTimestamp() });
    transaction.update(groupRef(db, groupId), {
      memberCount: Math.max(0, Number(group.data().memberCount || 0)) + 1,
      updatedAt: serverTimestamp()
    });
    return "member";
  });
};

export const leaveGroup = async (db, groupId, uid) => {
  const userId = String(uid || "").trim();
  if (!groupId || !userId) return;
  await runTransaction(db, async (transaction) => {
    const group = await transaction.get(groupRef(db, groupId));
    const target = memberRef(db, groupId, userId);
    const existing = await transaction.get(target);
    if (!existing.exists()) return;
    if (existing.data().role === "owner") throw new Error("The Group owner cannot leave without transferring ownership.");
    transaction.delete(target);
    if (group.exists()) {
      transaction.update(groupRef(db, groupId), {
        memberCount: Math.max(0, Number(group.data().memberCount || 1) - 1),
        updatedAt: serverTimestamp()
      });
    }
  });
};

export const listGroupMembers = async (db, groupId) => {
  if (!groupId) return [];
  const snapshot = await getDocs(collection(db, "groups", groupId, "members"));
  return snapshot.docs.map(fromSnapshot);
};

export const setGroupModerator = async (db, groupId, actorUid, targetUid, enabled) => {
  if (!groupId || !actorUid || !targetUid) throw new Error("Group, owner, and member are required.");
  await runTransaction(db, async (transaction) => {
    const actor = await transaction.get(memberRef(db, groupId, actorUid));
    if (!actor.exists() || !canManageGroup(actor.data())) throw new Error("Only the Group owner can manage moderators.");
    const target = memberRef(db, groupId, targetUid);
    const current = await transaction.get(target);
    if (!current.exists()) throw new Error("That user is not a Group member.");
    if (current.data().role === "owner") throw new Error("The Group owner role cannot be changed here.");
    transaction.update(target, { role: enabled ? "moderator" : "member" });
  });
};

export const removeGroupMember = async (db, groupId, actorUid, targetUid) => {
  if (!groupId || !actorUid || !targetUid) throw new Error("Group, actor, and member are required.");
  await runTransaction(db, async (transaction) => {
    const actor = await transaction.get(memberRef(db, groupId, actorUid));
    if (!actor.exists() || !canModerateGroup(actor.data())) throw new Error("Only Group moderators can remove members.");
    const target = memberRef(db, groupId, targetUid);
    const current = await transaction.get(target);
    if (!current.exists()) return;
    if (current.data().role === "owner") throw new Error("The Group owner cannot be removed.");
    if (actor.data().role === "moderator" && current.data().role !== "member") throw new Error("Moderators can remove members only.");
    const group = await transaction.get(groupRef(db, groupId));
    transaction.delete(target);
    if (group.exists()) {
      transaction.update(groupRef(db, groupId), {
        memberCount: Math.max(0, Number(group.data().memberCount || 1) - 1),
        updatedAt: serverTimestamp()
      });
    }
  });
};

export const listGroupPosts = async (db, groupId) => {
  if (!groupId) return [];
  const snapshot = await getDocs(collection(db, "communityPosts"));
  return sortGroupPosts(snapshot.docs
    .map((entry) => ({ id: entry.id, ref: entry.ref, ...entry.data() }))
    .filter((entry) => entry.groupId === groupId && entry.moderationState !== "hidden"));
};

export const setGroupPostPinned = async (db, groupId, postId, actorUid, pinned) => {
  const actor = await getDoc(memberRef(db, groupId, actorUid));
  if (!actor.exists() || !canModerateGroup(actor.data())) throw new Error("Only Group moderators can pin posts.");
  const post = doc(db, "communityPosts", postId);
  const snapshot = await getDoc(post);
  if (!snapshot.exists() || snapshot.data().groupId !== groupId) throw new Error("That post is not part of this Group.");
  await updateDoc(post, {
    pinnedAt: pinned ? serverTimestamp() : deleteField(),
    pinnedBy: pinned ? String(actorUid) : deleteField()
  });
};
