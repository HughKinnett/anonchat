export const resolveConnectionsTarget = (search, signedInUserId) => {
  const requestedUserId = new URLSearchParams(search).get("uid");
  const targetUserId = requestedUserId || signedInUserId;
  return {
    targetUserId,
    canonicalSearch: `?uid=${encodeURIComponent(targetUserId)}`
  };
};
