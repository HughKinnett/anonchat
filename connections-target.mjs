export const resolveConnectionsTarget = (search, signedInUserId) => {
  const requested = new URLSearchParams(String(search || "")).get("uid")?.trim();
  const targetUserId = requested || signedInUserId;
  return {
    targetUserId,
    canonicalSearch: `?uid=${encodeURIComponent(targetUserId)}`
  };
};
