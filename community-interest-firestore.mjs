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

const communityRef = (db, communityId) => doc(db, "communities", communityId);
const memberRef = (db, communityId, uid) => doc(db, "communities", communityId, "members", uid);

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
