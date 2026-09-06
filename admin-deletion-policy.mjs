export const PROTECTED_ADMIN_USERNAMES = Object.freeze([
  "i_love_you_h",
  "cybercapone"
]);

export const ADMIN_USERNAMES = Object.freeze([
  ...PROTECTED_ADMIN_USERNAMES,
  "testaccount"
]);

export const normalizeUsername = (username) => typeof username === "string"
  ? username.trim().toLowerCase()
  : "";

export const isProtectedAdministrator = (username) =>
  PROTECTED_ADMIN_USERNAMES.includes(normalizeUsername(username));

export const isAuthorizedAdministratorUsername = (username) =>
  ADMIN_USERNAMES.includes(normalizeUsername(username));

export const canQueueAdminDeletion = ({ targetUid, username, existingJob, existingQueueState }) =>
  typeof targetUid === "string"
  && targetUid.trim().length > 0
  && !isProtectedAdministrator(username)
  && existingJob === false
  && existingQueueState === false;

export const hasAdminDeletionQueueState = (profile) =>
  ["adminDeletionRequestedAt", "adminDeletionRequestedBy", "adminDeletionStatus"]
    .some((field) => Object.hasOwn(profile ?? {}, field));

export const canAdminSetBanned = ({ username, nextBanned, existingJob, existingQueueState }) =>
  !isProtectedAdministrator(username)
  && (nextBanned === true
    || (nextBanned === false && existingJob === false && existingQueueState === false));

export const adminDeletionQueuePayloads = ({ targetUid, requesterUid, timestamp }) => {
  if (typeof targetUid !== "string" || targetUid.trim().length === 0) {
    throw new TypeError("A target UID is required");
  }
  if (typeof requesterUid !== "string" || requesterUid.trim().length === 0) {
    throw new TypeError("A requester UID is required");
  }
  if (timestamp === undefined) {
    throw new TypeError("A trusted timestamp is required");
  }

  return {
    profile: {
      banned: true,
      adminDeletionRequestedAt: timestamp,
      adminDeletionRequestedBy: requesterUid,
      adminDeletionStatus: "queued"
    },
    job: {
      targetUid,
      requesterUid,
      requestedAt: timestamp,
      status: "queued"
    }
  };
};
