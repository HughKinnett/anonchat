import { derivePairwiseKey, generateRoomKey, unwrapRoomKey, wrapRoomKey } from "./e2ee-crypto.mjs";
import { getE2eePublicIdentity } from "./e2ee-identity.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const roomKeyCache = new Map();
const cacheId = (kind, roomId) => `${kind}:${roomId}`;
export const roomKeyEnvelopeId = (kind, roomId, uid) => `${kind}_${roomId}_${uid}`;
const pairContext = (kind, roomId, leftUid, rightUid) => `room-wrap:${kind}:${roomId}:${[leftUid, rightUid].sort().join(":")}`;

const wrappingKeyFor = async (db, identity, otherUid, kind, roomId) => {
  const other = await getE2eePublicIdentity(db, otherUid);
  if (!other?.publicJwk) throw new Error("A room member has not enabled encrypted chats yet.");
  return derivePairwiseKey(identity.privateKey, other.publicJwk, pairContext(kind, roomId, identity.uid, otherUid));
};

export const createRoomKeyEnvelope = async (db, identity, kind, roomId) => {
  const roomKey = await generateRoomKey();
  const wrappingKey = await wrappingKeyFor(db, identity, identity.uid, kind, roomId);
  const envelope = await wrapRoomKey(roomKey, wrappingKey, `${kind}:${roomId}`, identity.uid);
  roomKeyCache.set(cacheId(kind, roomId), roomKey);
  return {
    roomKey,
    id: roomKeyEnvelopeId(kind, roomId, identity.uid),
    data: { kind, roomId, recipientUid: identity.uid, senderUid: identity.uid, envelope, version: 1, createdAt: serverTimestamp() }
  };
};

export const loadRoomKey = async (db, identity, kind, roomId) => {
  const keyId = cacheId(kind, roomId);
  if (roomKeyCache.has(keyId)) return roomKeyCache.get(keyId);
  const snapshot = await getDoc(doc(db, "e2eeRoomKeyEnvelopes", roomKeyEnvelopeId(kind, roomId, identity.uid)));
  if (!snapshot.exists()) return null;
  const record = snapshot.data();
  const wrappingKey = await wrappingKeyFor(db, identity, record.senderUid, kind, roomId);
  const roomKey = await unwrapRoomKey(record.envelope, wrappingKey, `${kind}:${roomId}`, identity.uid);
  roomKeyCache.set(keyId, roomKey);
  return roomKey;
};

export const grantRoomKey = async (db, identity, kind, roomId, recipientUid) => {
  const existing = await getDoc(doc(db, "e2eeRoomKeyEnvelopes", roomKeyEnvelopeId(kind, roomId, recipientUid)));
  if (existing.exists()) return false;
  const roomKey = await loadRoomKey(db, identity, kind, roomId);
  if (!roomKey) throw new Error("This room's encryption key is not available on this device.");
  const wrappingKey = await wrappingKeyFor(db, identity, recipientUid, kind, roomId);
  const envelope = await wrapRoomKey(roomKey, wrappingKey, `${kind}:${roomId}`, recipientUid);
  await setDoc(existing.ref, {
    kind, roomId, recipientUid, senderUid: identity.uid, envelope, version: 1, createdAt: serverTimestamp()
  });
  return true;
};

export const clearRoomKeyCache = () => roomKeyCache.clear();
