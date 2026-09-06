export const canonicalConversationId = (leftUid, rightUid) => {
  const left = String(leftUid || "").trim();
  const right = String(rightUid || "").trim();
  if (!left || !right) throw new TypeError("Both conversation participants are required.");
  if (left === right) throw new TypeError("Conversation participants must be distinct.");
  return [left, right].sort().join("_");
};

export const isCanonicalConversationId = (id, leftUid, rightUid) => {
  try {
    return String(id || "") === canonicalConversationId(leftUid, rightUid);
  } catch {
    return false;
  }
};
