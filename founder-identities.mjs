export const FOUNDER_USERNAMES = Object.freeze([
  "i_love_you_h",
  "cybercapone",
  "ownercybercapone"
]);

export const normalizeFounderUsername = (username) => typeof username === "string"
  ? username.trim().toLowerCase()
  : "";

export const isAnonChatFounder = (username) =>
  FOUNDER_USERNAMES.includes(normalizeFounderUsername(username));
