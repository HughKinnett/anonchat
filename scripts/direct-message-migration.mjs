import { applicationDefault, deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

const projectId = process.env.GCLOUD_PROJECT || "anonchatlogin";
const app = initializeApp({ credential: applicationDefault(), projectId }, "direct-message-migration");
const db = getFirestore(app);
const PAGE_SIZE = 200;

const validPair = (data) => Array.isArray(data?.participants)
  && data.participants.length === 2
  && data.participants.every((uid) => typeof uid === "string" && uid)
  && data.participants[0] !== data.participants[1]
  && data.participants.includes(data.senderId);

const requestIdFor = (participants) => [...participants].sort().join("_");

const migrate = async () => {
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
      writes += 1;
      migrated += 1;
    });
    if (writes) await batch.commit();
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < PAGE_SIZE) break;
  }
  console.log(`DIRECT_MESSAGE_MIGRATION_COMPLETE inspected=${inspected} copied=${migrated}`);
};

migrate().catch(() => {
  console.error("DIRECT_MESSAGE_MIGRATION_FAILED");
  process.exitCode = 1;
}).finally(() => deleteApp(app));
