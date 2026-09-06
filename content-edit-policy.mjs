const ownerUid = (record = {}) => String(record.uid || record.authorId || record.userId || "");

export const canEditOwnedContent = (record = {}, uid = "") =>
  Boolean(uid) && ownerUid(record) === String(uid);

export const nextEditMetadata = (record = {}, now = Date.now()) => ({
  editedAt: now,
  editVersion: Math.max(0, Number(record.editVersion) || 0) + 1
});

export const buildEditHistorySnapshot = (record = {}, editorUid = "", now = Date.now()) => ({
  content: String(record.content ?? record.text ?? ""),
  editVersion: Math.max(0, Number(record.editVersion) || 0),
  editorUid: String(editorUid || ""),
  archivedAt: now
});
