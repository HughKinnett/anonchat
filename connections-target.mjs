export const resolveConnectionsTarget = (_search, signedInUserId) => ({
  targetUserId: signedInUserId,
  canonicalSearch: `?uid=${encodeURIComponent(signedInUserId)}`
});
