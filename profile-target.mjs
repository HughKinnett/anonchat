export const resolveProfileTarget = ({ search = "", currentUserUid = "" } = {}) => {
  const queryUid = new URLSearchParams(String(search || "")).get("uid")?.trim() || "";
  const ownerUid = String(currentUserUid || "").trim();
  return queryUid || ownerUid || null;
};
