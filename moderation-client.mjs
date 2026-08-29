import { blockId, reportHoldPatch, reportId, reportIntakePayload } from "./moderation-policy.mjs";

const alreadyReported = () => Object.assign(new Error("This item has already been reported."), {
  code: "already-reported"
});

export const createModerationClient = ({ db, firestore, currentUid, timestamp, clock = () => Date.now(), negativeCacheMs = 15_000, channelFactory }) => {
  const { deleteDoc, doc, getDoc, setDoc, writeBatch } = firestore;
  const reportRef = (target) => doc(db, "reportIntakes", reportId(currentUid, target.targetKind, target.targetId));
  const receiptRef = (target) => doc(db, "reportReceipts", currentUid, target.targetKind, target.targetId);
  const ownBlockRef = (uid) => doc(db, "blocks", blockId(currentUid, uid));
  const reportKey = (target) => `${target.targetKind}:${target.targetId}`;
  const reported = new Map();
  const pendingChecks = new Map();
  const watches = new Map();
  let active = true;
  const createChannel = channelFactory ?? (typeof globalThis.BroadcastChannel === "function"
    ? (name) => new globalThis.BroadcastChannel(name) : null);
  const channel = createChannel?.(`anonchat-report-receipts:${currentUid}`) ?? null;
  channel?.unref?.();
  const updateReported = (key, value) => {
    const previous = reported.get(key)?.value;
    const effective = previous === true ? true : value;
    if (!active) return previous ?? effective;
    const changed = previous !== effective;
    reported.set(key, { value: effective, checkedAt: clock() });
    if (changed && effective === true) watches.get(key)?.callbacks.forEach((callback) => callback(true));
    return effective;
  };
  if (channel) channel.onmessage = (event) => {
    if (event?.data?.reported === true && typeof event.data.key === "string") updateReported(event.data.key, true);
  };

  const hasReported = async (target) => {
    const key = reportKey(target);
    const cached = reported.get(key);
    if (cached?.value === true || (cached?.value === false && clock() - cached.checkedAt <= negativeCacheMs)) return cached.value;
    if (!pendingChecks.has(key)) pendingChecks.set(key, getDoc(receiptRef(target)).then((snapshot) => {
      const exists = snapshot.exists();
      pendingChecks.delete(key);
      return updateReported(key, exists);
    }, (error) => { pendingChecks.delete(key); throw error; }));
    return pendingChecks.get(key);
  };
  const cachedReported = (target) => {
    const key = reportKey(target); const cached = reported.get(key);
    if (!cached || (cached.value === false && clock() - cached.checkedAt > negativeCacheMs)) { reported.delete(key); return undefined; }
    return cached.value;
  };
  const watchReported = (target, onChange = () => {}) => {
    const key = reportKey(target);
    if (!watches.has(key)) watches.set(key, { target, callbacks: new Set() });
    watches.get(key).callbacks.add(onChange);
    return () => {
      const watch = watches.get(key); watch?.callbacks.delete(onChange);
      if (watch?.callbacks.size === 0) watches.delete(key);
    };
  };
  const invalidateNegative = () => {
    for (const [key, cached] of reported) if (cached.value === false) reported.delete(key);
  };
  const destroy = () => {
    active = false; watches.clear(); pendingChecks.clear(); channel?.close?.();
  };

  const report = async (target, reason) => {
    const payload = reportIntakePayload({
      reporterUid: currentUid,
      ...target,
      reason,
      timestamp: timestamp()
    });
    const ref = reportRef(target); const receipt = receiptRef(target);
    if (await hasReported(target)) throw alreadyReported();
    const key = reportKey(target);
    try {
      const hold = reportHoldPatch({
        reporterUid: currentUid,
        targetKind: target.targetKind,
        targetId: target.targetId,
        timestamp: payload.createdAt
      });
      const materialRef = hold ? doc(db, target.targetCollection, target.targetId) : undefined;
      const materialSnapshot = materialRef ? await getDoc(materialRef) : undefined;
      const material = materialSnapshot?.exists() ? materialSnapshot.data() : undefined;
      const batch = writeBatch(db);
      batch.set(ref, payload);
      batch.set(receipt, { reporterUid: currentUid, targetKind: target.targetKind, targetId: target.targetId, createdAt: payload.createdAt });
      if (hold) {
        batch.update(materialRef, hold);
        batch.set(doc(db, "moderationCases", `${target.targetKind}_${target.targetId}`), {
          targetKind: target.targetKind,
          targetCollection: target.targetCollection,
          targetId: target.targetId,
          targetPath: `${target.targetCollection}/${target.targetId}`,
          reportedUserId: target.reportedUserId,
          snapshot: {
            kind: target.targetKind,
            authorId: String(material?.authorId || target.reportedUserId),
            authorName: String(material?.username || "anonymous").slice(0, 100),
            text: String(material?.content || "").slice(0, 500)
          },
          status: "open",
          reportCount: 1,
          reasonTotals: { [reason]: 1 },
          createdAt: payload.createdAt,
          updatedAt: payload.createdAt
        });
      }
      await batch.commit();
      updateReported(key, true); channel?.postMessage?.({ key, reported: true });
    } catch (writeError) {
      if (reported.get(key)?.value !== true) reported.delete(key);
      let duplicate = false;
      try { duplicate = await hasReported(target); } catch {}
      if (duplicate) throw alreadyReported();
      throw writeError;
    }
  };

  const block = async (uid) => {
    const ref = ownBlockRef(uid);
    await setDoc(ref, { blockerUid: currentUid, blockedUid: uid, createdAt: timestamp() });
  };

  const unblock = async (uid) => deleteDoc(ownBlockRef(uid));

  const isPairBlocked = async (uid) => {
    // Blocks are private to their owner. The rules enforce the reverse direction,
    // while this client can safely read only the viewer's own block document.
    if (uid === currentUid) return false;
    return (await getDoc(ownBlockRef(uid))).exists();
  };

  return { report, hasReported, cachedReported, watchReported, invalidateNegative, destroy, block, unblock, isPairBlocked };
};
