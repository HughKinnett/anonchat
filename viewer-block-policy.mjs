const dataOf = (entry) => entry?.data?.() ?? entry?.data ?? {};

const uniqueSorted = (values) => [...new Set(values.filter((value) =>
  typeof value === "string" && value
))].sort();

export const createViewerBlockState = ({
  currentUid,
  outgoing = [],
  incoming = [],
  outgoingReady = false,
  incomingReady = false
} = {}) => {
  const outgoingUids = uniqueSorted(outgoing.map((entry) => {
    const data = dataOf(entry);
    return data.blockerUid === currentUid ? data.blockedUid : "";
  }));
  const incomingUids = uniqueSorted(incoming.map((entry) => {
    const data = dataOf(entry);
    return data.blockedUid === currentUid ? data.blockerUid : "";
  }));
  return Object.freeze({
    ready: Boolean(currentUid && outgoingReady && incomingReady),
    outgoingUids: Object.freeze(outgoingUids),
    incomingUids: Object.freeze(incomingUids),
    blockedUids: Object.freeze(uniqueSorted([...outgoingUids, ...incomingUids]))
  });
};

export const isBlockedActor = (uid, state) =>
  !state?.ready || state.blockedUids.includes(uid);

export const didViewerBlock = (uid, state) =>
  Boolean(state?.ready && state.outgoingUids.includes(uid));

export const isBlockedPost = (record, state) => {
  if (!state?.ready) return false;
  const data = dataOf(record);
  return !isBlockedActor(data.authorId, state)
    && (data.type !== "repost" || !isBlockedActor(data.originalAuthorId, state));
};

export const visibleRecords = (records, state, actorFields) => {
  if (!state?.ready) return [];
  return records.filter((entry) => {
    const data = dataOf(entry);
    return actorFields.every((field) => !isBlockedActor(data[field], state));
  });
};

export const createViewerBlockTracker = (currentUid) => {
  let uid = currentUid;
  let outgoing = [];
  let incoming = [];
  let outgoingReady = false;
  let incomingReady = false;
  const current = () => createViewerBlockState({
    currentUid: uid, outgoing, incoming, outgoingReady, incomingReady
  });
  return Object.freeze({
    current,
    update(direction, documents) {
      if (direction === "outgoing") {
        outgoing = Array.isArray(documents) ? documents : [];
        outgoingReady = true;
      } else if (direction === "incoming") {
        incoming = Array.isArray(documents) ? documents : [];
        incomingReady = true;
      } else throw new Error("invalid-block-direction");
      return current();
    },
    fail(direction) {
      if (direction === "outgoing") {
        outgoing = [];
        outgoingReady = false;
      } else if (direction === "incoming") {
        incoming = [];
        incomingReady = false;
      } else throw new Error("invalid-block-direction");
      return current();
    },
    reset(nextUid = uid) {
      uid = nextUid;
      outgoing = [];
      incoming = [];
      outgoingReady = false;
      incomingReady = false;
      return current();
    }
  });
};
