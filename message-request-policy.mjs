export const messageRequestDecision = (request, currentUserId) => {
  if (!request) return { action: "create" };
  if (![request.fromId, request.toId].includes(currentUserId)) return { action: "invalid" };
  const otherId = request.fromId === currentUserId ? request.toId : request.fromId;
  if (request.status === "accepted") return { action: "accepted", otherId };
  if (request.status === "pending") {
    return { action: request.fromId === currentUserId ? "outgoing-pending" : "incoming-pending", otherId };
  }
  if (request.status === "declined") return { action: "retry", otherId };
  return { action: "invalid", otherId };
};

export const messageRequestButtonAction = (request, currentUserId) => {
  const decision = messageRequestDecision(request, currentUserId);
  return decision.action === "incoming-pending" ? "accept-incoming" : decision.action;
};
