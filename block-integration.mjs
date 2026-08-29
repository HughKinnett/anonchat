import { blockId } from "./moderation-policy.mjs";

export const isBlockedPair = (leftUid, rightUid, pairs) => {
  if (!leftUid || !rightUid || !pairs) return false;
  return pairs.has(blockId(leftUid, rightUid)) || pairs.has(blockId(rightUid, leftUid));
};

export const createBlockPairTracker = ({ onChange = () => {}, onError = () => {} } = {}) => {
  let blocksCreatedByUser = [];
  let blocksTargetingUser = [];
  let createdLoaded = false;
  let targetedLoaded = false;
  let pairs = new Set();

  const publish = () => {
    if (!createdLoaded || !targetedLoaded) return;
    pairs = new Set([...blocksCreatedByUser, ...blocksTargetingUser].map((block) => block.id));
    onChange(new Set(pairs));
  };

  return {
    get initialized() {
      return createdLoaded && targetedLoaded;
    },
    get pairs() {
      return new Set(pairs);
    },
    receiveCreated(snapshot) {
      blocksCreatedByUser = snapshot.docs;
      createdLoaded = true;
      publish();
    },
    receiveTargeted(snapshot) {
      blocksTargetingUser = snapshot.docs;
      targetedLoaded = true;
      publish();
    },
    reportError(error) {
      onError(error);
    }
  };
};

export const createBlockPairLoadGate = () => {
  let resolve;
  let result;
  const ready = new Promise((readyResolve) => { resolve = readyResolve; });
  const settle = (initialized, error) => {
    if (result) return result;
    result = { initialized, error };
    resolve(result);
    return result;
  };
  return {
    ready,
    succeed: () => settle(true),
    fail: (error) => settle(false, error)
  };
};

export const blockControlState = ({ currentUid, targetUid, pairs }) => {
  if (!currentUid || !targetUid || currentUid === targetUid) {
    return { visible: false, ownBlock: false, label: "" };
  }
  const ownBlock = pairs?.has(blockId(currentUid, targetUid)) || false;
  return { visible: true, ownBlock, label: ownBlock ? "Unblock User" : "Block User" };
};

export const profileBlockViewState = ({ initialized, error, currentUid, targetUid, pairs }) => {
  const contentVisible = Boolean(initialized) && !isBlockedPair(currentUid, targetUid, pairs);
  return {
    settled: Boolean(initialized || error),
    initialized: Boolean(initialized),
    contentVisible,
    status: contentVisible
      ? ""
      : error
        ? "This profile is unavailable because block settings could not load."
        : "This profile is unavailable.",
    control: blockControlState({ currentUid, targetUid, pairs })
  };
};

const messageData = (message) => typeof message?.data === "function" ? message.data() : message;

export const filterAccessibleDirectMessages = (messages, pairs, initialized) => {
  if (!initialized) return [];
  return messages.filter((message) => {
    const participants = messageData(message)?.participants;
    if (!Array.isArray(participants)) return false;
    return participants.every((leftUid, index) =>
      participants.slice(index + 1).every((rightUid) => !isBlockedPair(leftUid, rightUid, pairs))
    );
  });
};

export const loadBlockPairs = async ({ db, uid, onChange = () => {}, onError = () => {}, firestore: injectedFirestore }) => {
  if (!db || !uid) {
    onChange(new Set());
    return () => {};
  }

  let firestore = injectedFirestore;
  if (!firestore) {
    try {
      firestore = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
    } catch (error) {
      onError(error);
      return () => {};
    }
  }
  const { collection, onSnapshot, query, where } = firestore;
  const tracker = createBlockPairTracker({ onChange, onError });
  const stopCreated = onSnapshot(
    query(collection(db, "blocks"), where("blockerId", "==", uid)),
    (snapshot) => tracker.receiveCreated(snapshot),
    (error) => tracker.reportError(error)
  );
  const stopTargeted = onSnapshot(
    query(collection(db, "blocks"), where("blockedId", "==", uid)),
    (snapshot) => tracker.receiveTargeted(snapshot),
    (error) => tracker.reportError(error)
  );
  return () => {
    stopCreated();
    stopTargeted();
  };
};
