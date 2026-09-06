import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || "anonchatlogin";
const app = initializeApp({ credential: applicationDefault(), projectId }, "direct-message-migration");
const db = getFirestore(app);
const PAGE_SIZE = 200;
const WRITE_BATCH_SIZE = 400;
const CHILD_COLLECTIONS = ["messages", "messageReactions", "messageVisibility"];

const validPair = (data) => Array.isArray(data?.participants)
  && data.participants.length === 2
  && data.participants.every((uid) => typeof uid === "string" && uid)
  && data.participants[0] !== data.participants[1]
  && data.participants.includes(data.senderId);

const requestIdFor = (participants) => [...participants].sort().join("_");
const canonicalConversationId = (fromId, toId) => [fromId, toId].filter(Boolean).sort().join("_");
const acceptedPair = (data = {}) => typeof data.fromId === "string"
  && typeof data.toId === "string"
  && data.fromId
  && data.toId
  && data.fromId !== data.toId
  && data.status === "accepted";

const commitSets = async (writes) => {
  for (let offset = 0; offset < writes.length; offset += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const write of writes.slice(offset, offset + WRITE_BATCH_SIZE)) {
      batch.set(write.ref, write.data, { merge: true });
    }
    await batch.commit();
  }
};

const commitDeletes = async (refs) => {
  for (let offset = 0; offset < refs.length; offset += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    refs.slice(offset, offset + WRITE_BATCH_SIZE).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
};

const moveChildCollection = async (sourceRef, targetRef, collectionName) => {
  const source = await sourceRef.collection(collectionName).get();
  if (source.empty) return 0;

  await commitSets(source.docs.map((document) => ({
    ref: targetRef.collection(collectionName).doc(document.id),
    data: document.data()
  })));

  const target = await targetRef.collection(collectionName).get();
  const targetIds = new Set(target.docs.map((document) => document.id));
  const missing = source.docs.filter((document) => !targetIds.has(document.id));
  if (missing.length) throw new Error(`Could not verify ${collectionName} migration for ${sourceRef.id}`);

  await commitDeletes(source.docs.map((document) => document.ref));
  return source.size;
};

const migrateRetiredDirectMessages = async () => {
  let cursor;
  let inspected = 0;
  let migrated = 0;
  while (true) {
    let query = db.collection("directMessages")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;
    inspected += snapshot.size;

    const prepared = snapshot.docs
      .filter((message) => validPair(message.data()))
      .map((message) => ({
        message,
        requestId: requestIdFor(message.data().participants)
      }));
    const uniqueRequestIds = [...new Set(prepared.map(({ requestId }) => requestId))];
    const requestSnapshots = uniqueRequestIds.length
      ? await db.getAll(...uniqueRequestIds.map((id) => db.doc(`messageRequests/${id}`)))
      : [];
    const requests = new Map(requestSnapshots.map((request) => [request.id, request]));

    const batch = db.batch();
    let writes = 0;
    prepared.forEach(({ message, requestId }) => {
      const request = requests.get(requestId);
      const data = request?.data();
      if (!request?.exists || data?.status !== "accepted") return;
      const participants = message.data().participants;
      if (![data.fromId, data.toId].every((uid) => participants.includes(uid))) return;
      batch.set(db.doc(`messageRequests/${requestId}/messages/${message.id}`), message.data());
      batch.delete(message.ref);
      writes += 2;
      migrated += 1;
    });
    if (writes) await batch.commit();
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < PAGE_SIZE) break;
  }
  console.log(`DIRECT_MESSAGE_MIGRATION_COMPLETE inspected=${inspected} moved=${migrated}`);
};

const migrateAcceptedConversationHeaders = async () => {
  let cursor;
  let inspected = 0;
  let canonicalized = 0;
  let messagesMoved = 0;
  let reactionsMoved = 0;
  let visibilityMoved = 0;
  let legacyRemoved = 0;

  while (true) {
    let query = db.collection("messageRequests")
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const request of snapshot.docs) {
      inspected += 1;
      const data = request.data() || {};
      if (!acceptedPair(data)) continue;
      const canonicalId = [data.fromId, data.toId].sort().join("_");
      if (request.id === canonicalId) continue;

      const canonicalRef = db.collection("messageRequests").doc(canonicalId);
      const canonicalSnapshot = await canonicalRef.get();
      if (canonicalSnapshot.exists) {
        const canonicalData = canonicalSnapshot.data() || {};
        if (!acceptedPair(canonicalData)
          || ![canonicalData.fromId, canonicalData.toId].includes(data.fromId)
          || ![canonicalData.fromId, canonicalData.toId].includes(data.toId)) {
          throw new Error(`Canonical conversation conflict for ${request.id}`);
        }
      } else {
        await canonicalRef.set({
          ...data,
          fromId: data.fromId,
          toId: data.toId,
          status: "accepted",
          canonicalizedFrom: request.id
        }, { merge: true });
      }

      for (const collectionName of CHILD_COLLECTIONS) {
        const moved = await moveChildCollection(request.ref, canonicalRef, collectionName);
        if (collectionName === "messages") messagesMoved += moved;
        if (collectionName === "messageReactions") reactionsMoved += moved;
        if (collectionName === "messageVisibility") visibilityMoved += moved;
      }

      const verified = await canonicalRef.get();
      if (!verified.exists || verified.data()?.status !== "accepted") {
        throw new Error(`Could not verify canonical conversation ${canonicalId}`);
      }

      await request.ref.delete();
      canonicalized += 1;
      legacyRemoved += 1;
    }

    cursor = snapshot.docs.at(-1);
    if (snapshot.size < PAGE_SIZE) break;
  }

  console.log(
    `DIRECT_MESSAGE_CONVERSATION_MIGRATION inspected=${inspected} canonicalized=${canonicalized} `
    + `messagesMoved=${messagesMoved} reactionsMoved=${reactionsMoved} visibilityMoved=${visibilityMoved} `
    + `legacyRemoved=${legacyRemoved}`
  );
};

const migrate = async () => {
  await migrateRetiredDirectMessages();
  await migrateAcceptedConversationHeaders();
};

migrate().catch((error) => {
  console.error("DIRECT_MESSAGE_MIGRATION_FAILED", error?.message || error);
  process.exitCode = 1;
}).finally(() => deleteApp(app));
