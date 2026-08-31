export const isDesignatedAdmin = (username) =>
  ["i_love_you_h", "cybercapone"].includes(String(username || "").trim().toLowerCase());
