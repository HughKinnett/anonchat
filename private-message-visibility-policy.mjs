export const canUnsendMessage = ({ currentUid, senderId, unsentAt } = {}) =>
  Boolean(currentUid && currentUid === senderId && !unsentAt);

export const isMessageVisibleToUser = ({ hiddenFor = [], uid } = {}) =>
  Boolean(uid && !hiddenFor.includes(uid));
