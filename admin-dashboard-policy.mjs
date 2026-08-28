const DAY_MS = 24 * 60 * 60 * 1000;
const PROCESSOR_WORKING_MS = 10 * 60 * 1000;
const PROCESSOR_DELAYED_MS = 20 * 60 * 1000;

export const timestampMillis = value => {
  const millis = value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : value);
  return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
};

export const hasDeletionJob = (user, deletionJobs = new Map()) => deletionJobs.has(user.id)
  || ["adminDeletionRequestedAt", "adminDeletionRequestedBy", "adminDeletionStatus"].some(key => key in user);

export const statusForUser = (user, { now = Date.now(), deletionJobs = new Map() } = {}) => {
  if (hasDeletionJob(user, deletionJobs)) return { kind: "deletion-pending", label: "Deletion Pending" };
  if (user.banned === true) return { kind: "banned", label: "Banned" };
  const activeAt = timestampMillis(user.lastActiveAt);
  if (activeAt === null) return { kind: "activity-not-recorded", label: "Activity Not Recorded" };
  return now - activeAt >= 7 * DAY_MS
    ? { kind: "inactive", label: "Inactive" }
    : { kind: "active", label: "Active" };
};

export const filterUsers = (users, { filter = "all", search = "", now = Date.now(), deletionJobs = new Map() } = {}) => {
  const needle = String(search).toLowerCase();
  return users.filter(user => {
    const status = statusForUser(user, { now, deletionJobs }).kind;
    return (!needle || String(user.username || "").toLowerCase().includes(needle))
      && (filter === "all" || status === filter);
  });
};

export const sortInactiveUsers = (users, { now = Date.now(), deletionJobs = new Map() } = {}) => filterUsers(users, {
  filter: "inactive", now, deletionJobs
}).sort((left, right) => timestampMillis(left.lastActiveAt) - timestampMillis(right.lastActiveAt));

export const canConfirmDeletion = ({ typedUsername, targetUsername, blocked }) => !blocked
  && typeof targetUsername === "string"
  && typedUsername === targetUsername;

export const deletionDialogJobTransition = (dialog, job) => {
  if (!dialog.open || job?.id !== dialog.targetUid) return dialog;
  return {
    ...dialog,
    open: false,
    feedback: job.status === "failed"
      ? "This account is already locked for permanent deletion and needs attention."
      : "This account is already locked for permanent deletion."
  };
};

export const processorHealth = (processor, now = Date.now()) => {
  const updatedAt = timestampMillis(processor?.updatedAt);
  if (processor?.status === "failed" || updatedAt === null || now < updatedAt) {
    return { kind: "not-running", label: "Not running" };
  }
  const age = now - updatedAt;
  if (age <= PROCESSOR_WORKING_MS) return { kind: "working", label: "Working normally" };
  if (age <= PROCESSOR_DELAYED_MS) return { kind: "delayed", label: "Delayed" };
  return { kind: "not-running", label: "Not running" };
};
