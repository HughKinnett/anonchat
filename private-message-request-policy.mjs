export const canCreateMessageRequest = ({
  mode = "everyone",
  followsRecipient = false,
  blocked = false,
  alreadyAccepted = false
} = {}) => {
  if (blocked) return false;
  if (alreadyAccepted) return true;
  if (mode === "none") return false;
  if (mode === "people-i-follow") return Boolean(followsRecipient);
  return mode === "everyone";
};
