import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  canManageCommunity,
  canModerateCommunity,
  normalizeCommunity,
  sortCommunityPosts
} from "./community-interest-policy.mjs";
import {
  canManageCommunityBadges,
  normalizeCommunityBadge
} from "./community-badge-policy.mjs";

const communityRef = (db, communityId) => doc(db, "communities", communityId);
const memberRef = (db, communityId, uid) => doc(db, "communities", communityId, "members", uid);
const communityBadgeRef = (db, communityId, badgeId) => doc(db, "communities", communityId, "badges", badgeId);
const communityMemberBadgeRef = (db, communityId, uid, badgeId) =>
  doc(db, "communities", communityId, "members", uid, "badges", badgeId);

const communityFrom = (entry) => ({ id: entry.id, ...entry.data() });

export const listCommunities = async (db) => {
  const snapshot = await getDocs(collection(db, "communities"));
  return snapshot.docs
    .map(communityFrom)
    .filter((entry) => entry.visibility === "public" && entry.status !== "archived")
    .sort((left, right) => Number(right.createdAt?.toMillis?.() ?? 0) - Number(left.createdAt?.toMillis?.() ?? 0));
};

export const getCommunity = async (db, communityId) => {
  if (!communityId) return null;
  const snapshot = await getDoc(communityRef(db, communityId));
  return snapshot.exists() ? communityFrom(snapshot) : null;
};

export const createPublicCommunity = async (db, ownerUid, input = {}) => {
  const uid = String(ownerUid || "").trim();
  if (!uid) throw new Error("A signed-in owner is required.");
  const normalized = normalizeCommunity({ ...input, visibility: "public" });
  if (!normalized.name || !normalized.slug) throw new Error("Community name must be at least 3 characters.");
  if (!normalized.topic) throw new Error("Choose a Community topic.");

  const ref = doc(collection(db, "communities"));
  const batch = writeBatch(db);
  batch.set(ref, {
    ...normalized,
    ownerId: uid,
    visibility: "public",
    memberCount: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  batch.set(doc(db, "communities", ref.id, "members", uid), {
    uid,
    role: "owner",
    joinedAt: serverTimestamp()
  });
  await batch.commit();
  return ref.id;
};

export const joinCommunity = async (db, communityId, uid) => {
  const userId = String(uid || "").trim();
  if (!communityId || !userId) throw new Error("Community and user are required.");
  return runTransaction(db, async (transaction) => {
    const community = await transaction.get(communityRef(db, communityId));
    if (!community.exists() || community.data().visibility !== "public" || community.data().status === "archived") throw new Error("That Community is not available.");
    const target = memberRef(db, communityId, userId);
    const existing = await transaction.get(target);
    if (existing.exists()) return existing.data().role || "member";
    transaction.set(target, { uid: userId, role: "member", joinedAt: serverTimestamp() });
    return "member";
  });
};

export const leaveCommunity = async (db, communityId, uid) => {
  const userId = String(uid || "").trim();
  if (!communityId || !userId) return;
  await runTransaction(db, async (transaction) => {
    const target = memberRef(db, communityId, userId);
    const existing = await transaction.get(target);
    if (!existing.exists()) return;
    if (existing.data().role === "owner") throw new Error("The Community owner cannot leave without transferring ownership.");
    transaction.delete(target);
  });
};

export const listCommunityMembers = async (db, communityId) => {
  if (!communityId) return [];
  const snapshot = await getDocs(collection(db, "communities", communityId, "members"));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
};

export const setCommunityModerator = async (db, communityId, actorUid, targetUid, enabled) => {
  if (!communityId || !actorUid || !targetUid) throw new Error("Community, owner, and member are required.");
  await runTransaction(db, async (transaction) => {
    const actorSnapshot = await transaction.get(memberRef(db, communityId, actorUid));
    if (!actorSnapshot.exists() || !canManageCommunity(actorSnapshot.data())) throw new Error("Only the Community owner can manage moderators.");
    const target = memberRef(db, communityId, targetUid);
    const targetSnapshot = await transaction.get(target);
    if (!targetSnapshot.exists()) throw new Error("That user is not a Community member.");
    if (targetSnapshot.data().role === "owner") throw new Error("The Community owner role cannot be changed here.");
    transaction.update(target, { role: enabled ? "moderator" : "member" });
  });
};

export const listCommunityPosts = async (db, communityId) => {
  if (!communityId) return [];
  const snapshot = await getDocs(collection(db, "communityPosts"));
  return sortCommunityPosts(snapshot.docs
    .map((entry) => ({ id: entry.id, ref: entry.ref, ...entry.data() }))
    .filter((entry) => entry.communityId === communityId && entry.moderationState !== "hidden"));
};

export const setCommunityPostPinned = async (db, communityId, postId, actorUid, pinned) => {
  const actor = await getDoc(memberRef(db, communityId, actorUid));
  if (!actor.exists() || !canModerateCommunity(actor.data())) throw new Error("Only Community moderators can pin posts.");
  const post = doc(db, "communityPosts", postId);
  const snapshot = await getDoc(post);
  if (!snapshot.exists() || snapshot.data().communityId !== communityId) throw new Error("That post is not part of this Community.");
  await updateDoc(post, {
    pinnedAt: pinned ? serverTimestamp() : deleteField(),
    pinnedBy: pinned ? String(actorUid) : deleteField()
  });
};

export const listCommunityBadgeTypes = async (db, communityId) => {
  if (!communityId) return [];
  const snapshot = await getDocs(collection(db, "communities", communityId, "badges"));
  return snapshot.docs
    .map((entry) => ({ id: entry.id, ...entry.data() }))
    .filter((entry) => entry.active !== false)
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
};

export const saveCommunityBadgeType = async (db, communityId, actorUid, badgeId, input = {}) => {
  const id = String(badgeId || "").trim();
  if (!communityId || !actorUid || !id || id.includes("/")) throw new Error("Community, moderator, and badge id are required.");
  const actor = await getDoc(memberRef(db, communityId, actorUid));
  if (!actor.exists() || !canManageCommunityBadges(actor.data())) throw new Error("Only Community staff can manage badges.");
  const normalized = normalizeCommunityBadge(input);
  if (!normalized.name) throw new Error("Badge name is required.");
  const ref = communityBadgeRef(db, communityId, id);
  const existing = await getDoc(ref);
  await setDoc(ref, {
    ...normalized,
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    createdBy: existing.exists() ? existing.data().createdBy : actorUid,
    updatedAt: serverTimestamp()
  });
};

export const listCommunityMemberBadges = async (db, communityId, uid) => {
  if (!communityId || !uid) return [];
  const snapshot = await getDocs(collection(db, "communities", communityId, "members", uid, "badges"));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
};

export const setCommunityMemberBadge = async (db, communityId, actorUid, targetUid, badgeId) => {
  if (!communityId || !actorUid || !targetUid || !badgeId) throw new Error("Community, moderator, member, and badge are required.");
  const actor = await getDoc(memberRef(db, communityId, actorUid));
  if (!actor.exists() || !canManageCommunityBadges(actor.data())) throw new Error("Only Community staff can assign badges.");
  const target = await getDoc(memberRef(db, communityId, targetUid));
  if (!target.exists()) throw new Error("That user is not a Community member.");
  const badge = await getDoc(communityBadgeRef(db, communityId, badgeId));
  if (!badge.exists() || badge.data().active === false) throw new Error("That Community badge is not available.");
  const assignment = communityMemberBadgeRef(db, communityId, targetUid, badgeId);
  const existing = await getDoc(assignment);
  if (existing.exists()) return;
  await setDoc(assignment, {
    badgeId,
    assignedAt: serverTimestamp(),
    assignedBy: actorUid
  });
};

export const removeCommunityMemberBadge = async (db, communityId, actorUid, targetUid, badgeId) => {
  if (!communityId || !actorUid || !targetUid || !badgeId) return;
  const actor = await getDoc(memberRef(db, communityId, actorUid));
  if (!actor.exists() || !canManageCommunityBadges(actor.data())) throw new Error("Only Community staff can remove badges.");
  await deleteDoc(communityMemberBadgeRef(db, communityId, targetUid, badgeId));
};
