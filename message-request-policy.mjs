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

export const messageRequestButtonState = (request, currentUserId) => {
  const action = messageRequestButtonAction(request, currentUserId);
  if (action === "outgoing-pending") {
    return {
      action,
      label: "Request sent",
      disabled: true,
      hint: "Request sent. Waiting for this user to accept or decline."
    };
  }
  if (action === "accept-incoming") {
    return {
      action,
      label: "Accept request",
      disabled: false,
      hint: "This user already requested you. Accept to start messaging."
    };
  }
  if (action === "accepted") {
    return { action, label: "Conversation accepted", disabled: true, hint: "You can message this user below." };
  }
  if (action === "invalid") {
    return { action, label: "Unavailable", disabled: true, hint: "This request is unavailable." };
  }
  return { action, label: action === "retry" ? "Send request again" : "Send request", disabled: false, hint: "" };
};
