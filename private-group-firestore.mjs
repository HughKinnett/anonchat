import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { hasPremiumAccess } from "./premium-policy.mjs";
import { canModerateGroup, normalizeGroup } from "./group-policy.mjs";
import { ensureE2eeIdentity, getE2eePublicIdentity } from "./e2ee-identity.js";
import {
  createRoomKeyEnvelope,
  grantRoomKey,
  loadRoomKey,
  roomKeyEnvelopeId
} from "./e2ee-room-keys.js";

const PRIVATE_GROUP_KEY_KIND = "privateGroup";
const groupRef = (db, groupId) => doc(db, "groups", groupId);
const memberRef = (db, groupId, uid) => doc(db, "groups", groupId, "members", uid);
const envelopeRef = (db, groupId, uid) => doc(db, "e2eeRoomKeyEnvelopes", roomKeyEnvelopeId(PRIVATE_GROUP_KEY_KIND, groupId, uid));
const fromSnapshot = (entry) => ({ id: entry.id, ...entry.data() });

const activePrivateGroup = (value) => value?.visibility === "private"
  && value?.premiumRequired === true
  && value?.status !== "archived";

const requirePrivateGroup = async (db, groupId) => {
  const snapshot = await getDoc(groupRef(db, groupId));
  if (!snapshot.exists() || !activePrivateGroup(snapshot.data())) throw new Error("That private Group is not available.");
  return snapshot;
};

const requireGroupStaff = async (db, groupId, actorUid) => {
  const actor = await getDoc(memberRef(db, groupId, actorUid));
  if (!actor.exists() || !canModerateGroup(actor.data())) throw new Error("Only Group staff can manage private Group membership.");
  return actor.data();
};

export const createPrivateGroup = async (db, user, premiumRecord, input = {}) => {
  const uid = String(user?.uid || "").trim();
  if (!uid) throw new Error("A signed-in owner is required.");
  if (!hasPremiumAccess(premiumRecord)) throw new Error("An active Premium membership is required to create a private Group.");

  const normalized = normalizeGroup({ ...input, visibility: "private" });
  if (!normalized.name || !normalized.slug) throw new Error("Group name must be at least 3 characters.");
  if (!normalized.topic) throw new Error("Choose a Group topic.");

  const identity = await ensureE2eeIdentity(db, user);
  const ref = doc(collection(db, "groups"));
  const key = await createRoomKeyEnvelope(db, identity, PRIVATE_GROUP_KEY_KIND, ref.id);
  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.set(ref, {
    ...normalized,
    ownerId: uid,
    visibility: "private",
    premiumRequired: true,
    memberCount: 1,
    encrypted: true,
    cipherVersion: 1,
    createdAt: now,
    updatedAt: now
  });
  batch.set(memberRef(db, ref.id, uid), {
    uid,
    role: "owner",
    invitedBy: uid,
    joinedAt: now
  });
  batch.set(doc(db, "e2eeRoomKeyEnvelopes", key.id), key.data);
  await batch.commit();
  return ref.id;
};

export const listPrivateGroupsForMember = async (db, uid) => {
  const userId = String(uid || "").trim();
  if (!userId) return [];
  const memberships = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", userId)));
  const groups = await Promise.all(memberships.docs.map(async (membership) => {
    const parentGroup = membership.ref.parent?.parent;
    if (!parentGroup || parentGroup.parent?.id !== "groups") return null;
    const snapshot = await getDoc(parentGroup);
    if (!snapshot.exists() || !activePrivateGroup(snapshot.data())) return null;
    return { ...fromSnapshot(snapshot), role: membership.data().role || "member" };
  }));
  return groups.filter(Boolean).sort((left, right) => Number(right.createdAt?.toMillis?.() ?? 0) - Number(left.createdAt?.toMillis?.() ?? 0));
};

export const invitePrivateGroupMember = async (db, user, groupId, recipientUid) => {
  const actorUid = String(user?.uid || "").trim();
  const targetUid = String(recipientUid || "").trim();
  if (!actorUid || !groupId || !targetUid) throw new Error("Group, inviter, and recipient are required.");
  await requirePrivateGroup(db, groupId);
  await requireGroupStaff(db, groupId, actorUid);
  const recipientIdentity = await getE2eePublicIdentity(db, targetUid);
  if (!recipientIdentity?.publicJwk) throw new Error("That member must enable encrypted chats before joining this private Group.");

  const identity = await ensureE2eeIdentity(db, user);
  const actorKey = await loadRoomKey(db, identity, PRIVATE_GROUP_KEY_KIND, groupId);
  if (!actorKey) throw new Error("This private Group's encryption key is not available on this device.");

  let created = false;
  await runTransaction(db, async (transaction) => {
    const group = await transaction.get(groupRef(db, groupId));
    if (!group.exists() || !activePrivateGroup(group.data())) throw new Error("That private Group is not available.");
    const target = memberRef(db, groupId, targetUid);
    const existing = await transaction.get(target);
    if (existing.exists()) return;
    transaction.set(target, {
      uid: targetUid,
      role: "member",
      invitedBy: actorUid,
      joinedAt: serverTimestamp()
    });
    transaction.update(groupRef(db, groupId), {
      memberCount: Math.max(0, Number(group.data().memberCount || 0)) + 1,
      updatedAt: serverTimestamp()
    });
    created = true;
  });

  try {
    await grantRoomKey(db, identity, PRIVATE_GROUP_KEY_KIND, groupId, targetUid);
  } catch (error) {
    if (created) {
      await runTransaction(db, async (transaction) => {
        const group = await transaction.get(groupRef(db, groupId));
        const target = memberRef(db, groupId, targetUid);
        const existing = await transaction.get(target);
        if (!existing.exists() || existing.data().invitedBy !== actorUid) return;
        transaction.delete(target);
        if (group.exists()) transaction.update(groupRef(db, groupId), {
          memberCount: Math.max(0, Number(group.data().memberCount || 1) - 1),
          updatedAt: serverTimestamp()
        });
      });
    }
    throw error;
  }
  return created;
};

export const removePrivateGroupMember = async (db, actorUid, groupId, targetUid) => {
  const actorId = String(actorUid || "").trim();
  const targetId = String(targetUid || "").trim();
  if (!actorId || !groupId || !targetId) throw new Error("Group, actor, and member are required.");
  await requirePrivateGroup(db, groupId);
  await runTransaction(db, async (transaction) => {
    const actor = await transaction.get(memberRef(db, groupId, actorId));
    if (!actor.exists() || !canModerateGroup(actor.data())) throw new Error("Only Group staff can remove private Group members.");
    const target = memberRef(db, groupId, targetId);
    const current = await transaction.get(target);
    if (!current.exists()) return;
    if (current.data().role === "owner") throw new Error("The Group owner cannot be removed.");
    if (actor.data().role === "moderator" && current.data().role !== "member") throw new Error("Moderators can remove members only.");
    const group = await transaction.get(groupRef(db, groupId));
    transaction.delete(target);
    transaction.delete(envelopeRef(db, groupId, targetId));
    if (group.exists()) transaction.update(groupRef(db, groupId), {
      memberCount: Math.max(0, Number(group.data().memberCount || 1) - 1),
      updatedAt: serverTimestamp()
    });
  });
};

export const loadPrivateGroupKey = async (db, user, groupId) => {
  const uid = String(user?.uid || "").trim();
  if (!uid || !groupId) return null;
  await requirePrivateGroup(db, groupId);
  const membership = await getDoc(memberRef(db, groupId, uid));
  if (!membership.exists()) throw new Error("You are not a member of this private Group.");
  const identity = await ensureE2eeIdentity(db, user);
  return loadRoomKey(db, identity, PRIVATE_GROUP_KEY_KIND, groupId);
};

export const grantPrivateGroupKey = async (db, user, groupId, recipientUid) => {
  const actorUid = String(user?.uid || "").trim();
  const targetUid = String(recipientUid || "").trim();
  if (!actorUid || !groupId || !targetUid) throw new Error("Group, sender, and recipient are required.");
  await requirePrivateGroup(db, groupId);
  await requireGroupStaff(db, groupId, actorUid);
  const recipient = await getDoc(memberRef(db, groupId, targetUid));
  if (!recipient.exists()) throw new Error("That user is not a private Group member.");
  const identity = await ensureE2eeIdentity(db, user);
  return grantRoomKey(db, identity, PRIVATE_GROUP_KEY_KIND, groupId, targetUid);
};
