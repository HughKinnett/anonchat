export const createSessionGeneration = () => {
  let generation = 0;
  let uid = "";
  return Object.freeze({
    begin(nextUid) {
      generation += 1;
      uid = typeof nextUid === "string" ? nextUid : "";
      return generation;
    },
    invalidate() {
      generation += 1;
      uid = "";
      return generation;
    },
    isCurrent(candidate, candidateUid = uid) {
      return candidate === generation && Boolean(uid) && candidateUid === uid;
    }
  });
};
