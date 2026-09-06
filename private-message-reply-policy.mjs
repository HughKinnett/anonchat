const unavailable = (senderLabel = "") => ({
  state: "unavailable",
  senderLabel,
  snippet: "Original message unavailable."
});

export const resolveReplyPreview = (message = {}, original = null) => {
  const senderLabel = message.replyToSenderId || original?.senderId || "";
  if (!message.replyToMessageId || !original || original.unsentAt) return unavailable(senderLabel);
  const text = String(original.text || message.replyToSnippet || "").trim();
  return {
    state: "available",
    senderLabel,
    snippet: text || "Original message unavailable."
  };
};
