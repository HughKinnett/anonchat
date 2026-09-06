export const isDesignatedAdmin = (username) =>
  ["i_love_you_h", "cybercapone", "testaccount"].includes(String(username || "").trim().toLowerCase());
