import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreDeletionAdapter } from "../admin-deletion-firestore-adapter.mjs";
import { COMPLETION_RETENTION_MS, LEASE_MS, PAGE_LIMIT, cleanupQueries, isExactCompletionMarker } from "../admin-deletion-processor-policy.mjs";
import { runDeletionProcessor, scanPages } from "../admin-deletion-processor.mjs";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator is required");

const apps = [];
let scenarioNumber = 0;
const scenario = ({ now = 1_800_000_000_000, auth, authRenewIntervalMs, beforeRoomCleanupClaim, beforeRoomMessageCleanupClaim } = {}) => {
  scenarioNumber += 1;
  const projectId = `anonchat-deletion-integration-${scenarioNumber}`;
  const app = initializeApp({ projectId }, projectId);
  apps.push(app);
  const db = getFirestore(app);
  const clock = { now };
  const deletedUsers = [];
  const authAdapter = auth ?? {
    async deleteUser(uid) { deletedUsers.push(uid); }
  };
  let tokenNumber = 0;
  const makeAdapter = (ownerPrefix = "worker") => new FirestoreDeletionAdapter({
    db,
    auth: authAdapter,
    Timestamp,
    FieldPath,
    clock: () => clock.now,
    authRenewIntervalMs,
    tokenFactory: () => `${ownerPrefix}-token-${++tokenNumber}`,
    beforeRoomCleanupClaim, beforeRoomMessageCleanupClaim
  });
  return { db, clock, deletedUsers, makeAdapter };
};

const processingJob = ({ phase = "first-sweep", token = "worker-token", now = 1_800_000_000_000 } = {}) => ({
  targetUid: "target",
  requesterUid: "administrator",
  requestedAt: Timestamp.fromMillis(now - 10_000),
  status: "processing",
  processorVersion: 1,
  targetUsername: "target_name",
  phase,
  attempts: 1,
  leaseOwner: "worker",
  leaseToken: token,
  leaseExpiresAt: Timestamp.fromMillis(now + LEASE_MS)
});

const validProfile = (now) => ({
  uid: "target",
  username: "target_name",
  banned: true,
  adminDeletionStatus: "queued",
  adminDeletionRequestedBy: "administrator",
  adminDeletionRequestedAt: Timestamp.fromMillis(now - 10_000)
});

const queuedJob = (targetUid, now) => ({
  targetUid,
  requesterUid: "administrator",
  requestedAt: Timestamp.fromMillis(now - 10_000),
  status: "queued"
});

const internalJob = (targetUid, now, overrides = {}) => {
  const status = overrides.status ?? "processing";
  const job = {
    targetUid,
    requesterUid: "administrator",
    requestedAt: Timestamp.fromMillis(now - 10_000),
    status,
    processorVersion: 1,
    targetUsername: `${targetUid}_name`,
    phase: overrides.phase ?? "profile-barrier",
    attempts: 1
  };
  if (status === "failed") job.errorCode = overrides.errorCode ?? "AUTH_ERROR";
  if (status === "processing") Object.assign(job, {
    leaseOwner: "old-worker",
    leaseToken: "old-token",
    leaseExpiresAt: Timestamp.fromMillis(overrides.leaseExpiresAt ?? now - 1)
  });
  return job;
};

const administratorEntries = () => [
  ["users/administrator", { uid: "administrator", username: "i_love_you_h", banned: false }],
  ["usernames/i_love_you_h", { uid: "administrator", username: "i_love_you_h" }]
];

const putMany = async (db, entries) => {
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch();
    for (const [path, value] of entries.slice(offset, offset + 400)) batch.set(db.doc(path), value);
    await batch.commit();
  }
};

// Account deletion shares the room-closing evidence fence: a report arriving just before cascade cleanup is captured first.
{
  let db; let inserted = false;
  const setup = scenario({ beforeRoomCleanupClaim: async ({ roomId }) => {
    if (inserted || roomId !== "owned-room") return;
    inserted = true;
    await db.doc("reportIntakes/reporter_roomMessage_owned-message").set({
      reporterUid: "reporter", targetKind: "roomMessage", targetCollection: "roomMessages",
      targetId: "owned-message", targetPath: "roomMessages/owned-message", reportedUserId: "other-author",
      reason: "harassment", createdAt: Timestamp.fromMillis(setup.clock.now), status: "queued"
    });
  } });
  db = setup.db; const { clock, makeAdapter } = setup;
  await putMany(db, [
    ...administratorEntries(),
    ["adminDeletionJobs/target", queuedJob("target", clock.now)],
    ["users/target", validProfile(clock.now)],
    ["usernames/target_name", { uid: "target", username: "target_name" }],
    ["system/accountStats", { count: 2, limit: 500, updatedAt: Timestamp.fromMillis(clock.now - 1_000) }],
    ["reportReceipts/target/post/reported-post", { reporterUid: "target", targetKind: "post", targetId: "reported-post", createdAt: Timestamp.fromMillis(clock.now) }],
    ["rooms/owned-room", { ownerId: "target", createdAt: Timestamp.fromMillis(clock.now), expiresAt: Timestamp.fromMillis(clock.now + 86_400_000), moderationState: "visible" }],
    ["roomMessages/owned-message", { roomId: "owned-room", senderId: "other-author", tempName: "Temp", text: "account cascade evidence", createdAt: Timestamp.fromMillis(clock.now), expiresAt: Timestamp.fromMillis(clock.now + 86_400_000), moderationState: "visible" }]
  ]);
  const result = await runDeletionProcessor({ adapter: makeAdapter("shared-room-fence"), ownerId: "shared-room-fence", logger: { info() {}, error() {} } });
  assert.equal(result.processed, 1);
  assert.equal((await db.doc("rooms/owned-room").get()).exists, false);
  assert.equal((await db.doc("reportReceipts/target/post/reported-post").get()).exists, false, "private report receipts are recursively erased with the reporter account");
  const retained = (await db.doc("moderationCases/roomMessage_owned-message").get()).data();
  assert.equal(retained.snapshot.text, "account cascade evidence");
  assert.equal((await db.doc("reportIntakes/reporter_roomMessage_owned-message").get()).data().status, "processed");
}

// Deleting one reported message from a room owned by somebody else uses the same intake fence and reopens the surviving room.
{
  let db; let inserted = false;
  const setup = scenario({ beforeRoomMessageCleanupClaim: async ({ messageId }) => {
    if (inserted || messageId !== "target-message") return;
    inserted = true;
    await db.doc("reportIntakes/reporter_roomMessage_target-message").set({
      reporterUid: "reporter", targetKind: "roomMessage", targetCollection: "roomMessages",
      targetId: "target-message", targetPath: "roomMessages/target-message", reportedUserId: "target",
      reason: "hate-threats", createdAt: Timestamp.fromMillis(setup.clock.now), status: "queued"
    });
  } });
  db = setup.db; const { clock, makeAdapter } = setup;
  await putMany(db, [
    ...administratorEntries(),
    ["adminDeletionJobs/target", queuedJob("target", clock.now)],
    ["users/target", validProfile(clock.now)],
    ["usernames/target_name", { uid: "target", username: "target_name" }],
    ["system/accountStats", { count: 2, limit: 500, updatedAt: Timestamp.fromMillis(clock.now - 1_000) }],
    ["rooms/other-room", { ownerId: "other-owner", createdAt: Timestamp.fromMillis(clock.now), expiresAt: Timestamp.fromMillis(clock.now + 86_400_000), moderationState: "visible" }],
    ["roomMessages/target-message", { roomId: "other-room", senderId: "target", tempName: "Target", text: "single message evidence", createdAt: Timestamp.fromMillis(clock.now), expiresAt: Timestamp.fromMillis(clock.now + 86_400_000), moderationState: "visible" }]
  ]);
  const adapter = makeAdapter("shared-message-fence");
  const originalMessageCascade = adapter.deleteRoomMessageCascade.bind(adapter);
  let capturedBeforePermanentPurge = false;
  adapter.deleteRoomMessageCascade = async (...parameters) => {
    await originalMessageCascade(...parameters);
    capturedBeforePermanentPurge = (await db.doc("moderationCases/roomMessage_target-message").get()).data()?.snapshot?.text === "single message evidence";
  };
  await runDeletionProcessor({ adapter, ownerId: "shared-message-fence", logger: { info() {}, error() {} } });
  assert.equal((await db.doc("rooms/other-room").get()).data().cleanupState, "open");
  assert.equal((await db.doc("roomMessages/target-message").get()).exists, false);
  assert.equal(capturedBeforePermanentPurge, true, "the report is canonicalized before the message is destructively removed");
  assert.equal((await db.doc("moderationCases/roomMessage_target-message").get()).exists, false, "permanent account deletion purges protected evidence about that account");
  assert.equal((await db.doc("reportIntakes/reporter_roomMessage_target-message").get()).exists, false,
    "permanent account deletion purges the processed intake about that account after canonical capture");
}

// Stable document-name cursors must reach work behind more than one full page.
{
  const { db, clock, deletedUsers, makeAdapter } = scenario();
  const frontJobs = Array.from({ length: 205 }, (_, index) => [
    `adminDeletionJobs/a-${String(index).padStart(3, "0")}`,
    { status: "processing" }
  ]);
  const frontMarkers = Array.from({ length: 205 }, (_, index) => [
    `adminDeletionJobs/m-${String(index).padStart(3, "0")}`,
    { status: "completed", malformed: true }
  ]);
  await putMany(db, [
    ...frontJobs,
    ...administratorEntries(),
    ["adminDeletionJobs/z-queued", queuedJob("z-queued", clock.now)],
    ["users/z-queued", {
      uid: "z-queued",
      username: "z_queued",
      banned: true,
      adminDeletionStatus: "queued",
      adminDeletionRequestedBy: "administrator",
      adminDeletionRequestedAt: Timestamp.fromMillis(clock.now - 10_000)
    }],
    ["usernames/z_queued", { uid: "z-queued", username: "z_queued" }],
    ["system/accountStats", { count: 2, limit: 500, updatedAt: Timestamp.fromMillis(clock.now - 1_000) }],
    ...frontMarkers,
    ["adminDeletionJobs/z-marker", {
      status: "completed",
      completedAt: Timestamp.fromMillis(clock.now - COMPLETION_RETENTION_MS - 1),
      purgeAfter: Timestamp.fromMillis(clock.now - 1)
    }]
  ]);
  const adapter = makeAdapter();
  const jobs = [];
  for await (const page of scanPages((cursor) => adapter.scanJobsPage(cursor))) jobs.push(...page);
  const markers = [];
  for await (const page of scanPages((cursor) => adapter.scanMarkersPage(cursor))) markers.push(...page);
  assert.equal(jobs.length, 206);
  assert.equal(jobs.at(-1).id, "z-queued");
  assert.equal(markers.length, 206);
  assert.equal(markers.at(-1).id, "z-marker");
  const logs = [];
  const result = await runDeletionProcessor({
    adapter,
    ownerId: "pagination-worker",
    logger: { info: (code) => logs.push(code), error: (code) => logs.push(code) }
  });
  assert.deepEqual(result, { inspected: 206, processed: 1, failed: 0, skipped: 205, purged: 1 });
  assert.equal((await db.doc("adminDeletionJobs/z-marker").get()).exists, false);
  assert.equal(isExactCompletionMarker((await db.doc("adminDeletionJobs/z-queued").get()).data()), true);
  assert.deepEqual(deletedUsers, ["z-queued"]);
  assert.equal(logs.filter((code) => code === "MALFORMED_MARKER").length, 205);
}

// Profile removal is fail-closed unless accountStats can be decremented exactly once.
for (const stats of [
  undefined,
  { count: "2", limit: 500, updatedAt: Timestamp.fromMillis(1_799_999_000_000) },
  { count: 1.5, limit: 500, updatedAt: Timestamp.fromMillis(1_799_999_000_000) },
  { count: 0, limit: 500, updatedAt: Timestamp.fromMillis(1_799_999_000_000) }
]) {
  const { db, clock, makeAdapter } = scenario();
  await putMany(db, [
    ["adminDeletionJobs/target", processingJob({ now: clock.now })],
    ["users/target", validProfile(clock.now)],
    ["usernames/target_name", { uid: "target", username: "target_name" }],
    ...(stats ? [["system/accountStats", stats]] : [])
  ]);
  await assert.rejects(
    makeAdapter().removeProfileBarrier("target", "worker-token"),
    (error) => error.code === "account-stats-invalid"
  );
  assert.equal((await db.doc("users/target").get()).exists, true);
  assert.equal((await db.doc("usernames/target_name").get()).exists, true);
}

{
  const { db, clock, makeAdapter } = scenario();
  await putMany(db, [
    ["adminDeletionJobs/target", processingJob({ phase: "claimed", now: clock.now })],
    ["users/target", validProfile(clock.now)],
    ["usernames/target_name", { uid: "target", username: "target_name" }],
    ["system/accountStats", { count: 2, limit: 500, updatedAt: Timestamp.fromMillis(clock.now - 1_000) }]
  ]);
  await assert.rejects(
    makeAdapter().removeProfileBarrier("target", "worker-token"),
    (error) => error.code === "invalid-job"
  );
  assert.equal((await db.doc("users/target").get()).exists, true);
  assert.equal((await db.doc("system/accountStats").get()).data().count, 2);
}

{
  const { db, clock, makeAdapter } = scenario();
  await putMany(db, [
    ["adminDeletionJobs/target", processingJob({ now: clock.now })],
    ["users/target", validProfile(clock.now)],
    ["usernames/target_name", { uid: "target", username: "target_name" }],
    ["system/accountStats", { count: 2, limit: 500, updatedAt: Timestamp.fromMillis(clock.now - 1_000) }]
  ]);
  const adapter = makeAdapter();
  await adapter.removeProfileBarrier("target", "worker-token");
  assert.equal((await db.doc("users/target").get()).exists, false);
  assert.equal((await db.doc("system/accountStats").get()).data().count, 1);
  await assert.rejects(
    adapter.removeProfileBarrier("target", "worker-token"),
    (error) => error.code === "invalid-job"
  );
  assert.equal((await db.doc("system/accountStats").get()).data().count, 1);
}

// UID-owned reservations stay locked until finalization, then disappear atomically.
{
  const { db, clock, makeAdapter } = scenario();
  await putMany(db, [
    ["adminDeletionJobs/target", processingJob({ phase: "auth-deleted", now: clock.now })],
    ["usernames/recreated_name", { uid: "target", username: "recreated_name" }]
  ]);
  await makeAdapter().finalize(
    "target",
    "worker-token",
    Timestamp.fromMillis(clock.now),
    Timestamp.fromMillis(clock.now + COMPLETION_RETENTION_MS)
  );
  assert.equal((await db.doc("usernames/recreated_name").get()).exists, false);
  assert.equal(isExactCompletionMarker((await db.doc("adminDeletionJobs/target").get()).data()), true);
}

// The external Auth boundary is lease-owned, renewable, and safely reclaimable after expiry.
{
  let releaseAuth;
  let markAuthStarted;
  const authStarted = new Promise((resolve) => { markAuthStarted = resolve; });
  const auth = {
    async deleteUser() {
      markAuthStarted();
      await new Promise((resolve) => { releaseAuth = resolve; });
    }
  };
  const { db, clock, makeAdapter } = scenario({ auth, authRenewIntervalMs: 5 });
  await putMany(db, [
    ["adminDeletionJobs/target", processingJob({ phase: "second-sweep", now: clock.now })],
    ...administratorEntries()
  ]);
  const first = makeAdapter("stall-first");
  const second = makeAdapter("stall-second");
  await first.beginAuthDeletion("target", "worker-token");
  const deletion = first.deleteAuth("target", "worker-token");
  await authStarted;
  for (let interval = 0; interval < 3; interval += 1) {
    clock.now += Math.floor(LEASE_MS / 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await second.claim("target", "second-worker"), null);
  releaseAuth();
  await deletion;
  await first.finishAuthDeletion("target", "worker-token");
  assert.equal((await db.doc("adminDeletionJobs/target").get()).data().phase, "auth-deleted");
}

{
  const { db, clock, deletedUsers, makeAdapter } = scenario();
  await putMany(db, [
    ["adminDeletionJobs/target", processingJob({ phase: "second-sweep", now: clock.now })],
    ["users/administrator", { uid: "administrator", username: "i_love_you_h", banned: false }],
    ["usernames/i_love_you_h", { uid: "administrator", username: "i_love_you_h" }]
  ]);
  const first = makeAdapter("first");
  await first.beginAuthDeletion("target", "worker-token");
  let stored = (await db.doc("adminDeletionJobs/target").get()).data();
  assert.equal(stored.phase, "auth-deleting");
  assert.ok(stored.leaseExpiresAt.toMillis() > clock.now);

  clock.now += LEASE_MS + 1;
  const second = makeAdapter("second");
  const claimed = await second.claim("target", "second-worker");
  assert.equal(claimed.phase, "auth-deleting");
  await assert.rejects(
    first.deleteAuth("target", "worker-token"),
    (error) => error.code === "lease-lost"
  );
  assert.deepEqual(deletedUsers, []);
  await assert.rejects(
    first.finishAuthDeletion("target", "worker-token"),
    (error) => error.code === "lease-lost"
  );
  await second.beginAuthDeletion("target", claimed.token);
  await second.deleteAuth("target", claimed.token);
  await second.finishAuthDeletion("target", claimed.token);
  stored = (await db.doc("adminDeletionJobs/target").get()).data();
  assert.equal(stored.phase, "auth-deleted");
  assert.deepEqual(deletedUsers, ["target"]);
}

// The production query/cascade matrix and state machine complete a real queued deletion.
{
  const { db, clock, deletedUsers, makeAdapter } = scenario();
  const entries = [
    ...administratorEntries(),
    ["adminDeletionJobs/target", queuedJob("target", clock.now)],
    ["users/target", validProfile(clock.now)],
    ["usernames/target_name", { uid: "target", username: "target_name" }],
    ["usernames/legacy_target_name", { uid: "target", username: "legacy_target_name" }],
    ["users/prior-holder", { uid: "prior-holder", username: "renamed_prior_holder", banned: false }],
    ["usernames/renamed_prior_holder", { uid: "prior-holder", username: "renamed_prior_holder" }],
    ["posts/prior-holder-post", { authorId: "prior-holder", username: "target_name", content: "prior owner" }],
    ["posts/prior-holder-post/comments/prior-holder-comment", { uid: "prior-holder", username: "target_name" }],
    ["posts/prior-holder-post/comments/prior-holder-comment/replies/prior-holder-reply", { uid: "prior-holder", username: "target_name" }],
    ["communityPosts/prior-holder-community", { authorId: "prior-holder", username: "target_name", content: "prior owner" }],
    ["system/accountStats", { count: 2, limit: 500, updatedAt: Timestamp.fromMillis(clock.now - 1_000) }]
  ];
  const expectedDeletedPaths = new Set(["users/target", "usernames/target_name", "usernames/legacy_target_name"]);
  const priorHolderPaths = [
    "users/prior-holder",
    "usernames/renamed_prior_holder",
    "posts/prior-holder-post",
    "posts/prior-holder-post/comments/prior-holder-comment",
    "posts/prior-holder-post/comments/prior-holder-comment/replies/prior-holder-reply",
    "communityPosts/prior-holder-community"
  ];
  let entryNumber = 0;
  for (const descriptor of cleanupQueries("target", "target_name")) {
    entryNumber += 1;
    let path;
    if (descriptor.path) {
      path = `${descriptor.collection}/${descriptor.path}`;
    } else if (descriptor.group) {
      if (descriptor.collection === "comments") path = `posts/group-parent/comments/group-${entryNumber}`;
      if (descriptor.collection === "replies") path = `posts/group-parent/comments/group-parent/replies/group-${entryNumber}`;
      if (descriptor.collection === "reactions") path = `posts/group-parent/reactions/group-${entryNumber}`;
      if (descriptor.collection === "messages") path = `premiumRooms/group-parent/messages/group-${entryNumber}`;
      if (descriptor.collection === "reports") path = `moderationCases/group-parent/reports/group-${entryNumber}`;
    } else {
      path = `${descriptor.collection}/cleanup-${String(entryNumber).padStart(3, "0")}`;
    }
    const value = descriptor.operator === "array-contains" ? [descriptor.value, "other"] : descriptor.value;
    const data = descriptor.field ? { [descriptor.field]: value, fixture: "cleanup" } : { fixture: "cleanup" };
    entries.push([path, data]);
    expectedDeletedPaths.add(path);

    if (descriptor.cascade === "post") {
      const postId = path.split("/").at(-1);
      const descendants = [
        [`${path}/comments/child`, { uid: "other" }],
        [`${path}/comments/child/replies/reply`, { uid: "other" }],
        [`${path}/reactions/reaction`, { uid: "other" }],
        [`communityVotes/cascade-${entryNumber}`, { uid: "other", postId }],
        [`timelineVotes/cascade-${entryNumber}`, { uid: "other", postId }]
      ];
      entries.push(...descendants);
      descendants.forEach(([descendantPath]) => expectedDeletedPaths.add(descendantPath));
    }
    if (descriptor.cascade === "circle") {
      const circleId = path.split("/").at(-1);
      const descendants = [
        [`communityPosts/circle-child-${entryNumber}`, { authorId: "other", circleId }],
        [`communityPosts/circle-child-${entryNumber}/comments/child`, { uid: "other" }],
        [`circleMembers/circle-child-${entryNumber}`, { uid: "other", circleId }],
        [`${path}/metadata/child`, { fixture: "nested" }]
      ];
      entries.push(...descendants);
      descendants.forEach(([descendantPath]) => expectedDeletedPaths.add(descendantPath));
    }
    if (descriptor.cascade === "moderation-case") {
      const caseId = path.split("/").at(-1);
      const descendants = [
        [`${path}/reports/report`, { reporterUid: "other" }],
        [`moderationActions/${caseId}`, { action: "deleteMaterial", status: "queued" }]
      ];
      entries.push(...descendants);
      descendants.forEach(([descendantPath]) => expectedDeletedPaths.add(descendantPath));
    }
    if (["document", "roomMessage"].includes(descriptor.cascade)) {
      const descendants = [
        [`${path}/comments/nested`, { uid: "other" }],
        [`${path}/comments/nested/reactions/deep`, { uid: "other" }]
      ];
      entries.push(...descendants);
      descendants.forEach(([descendantPath]) => expectedDeletedPaths.add(descendantPath));
    }
    if (descriptor.cascade === "room") {
      const roomId = path.split("/").at(-1);
      const descendants = [
        [`roomMessages/room-child-${entryNumber}`, { senderId: "other", roomId }],
        [`roomMessages/room-child-${entryNumber}/comments/child`, { uid: "other" }],
        [`roomMessages/room-child-${entryNumber}/comments/child/replies/deep`, { uid: "other" }],
        [`roomMembers/room-child-${entryNumber}`, { uid: "other", roomId }],
        [`${path}/metadata/child`, { fixture: "nested" }]
      ];
      entries.push(...descendants);
      descendants.forEach(([descendantPath]) => expectedDeletedPaths.add(descendantPath));
    }
    if (descriptor.cascade === "document") {
      const descendants = [
        [`${path}/evidence/media`, { items: [{ kind: "profileImage", dataUrl: "data:image/jpeg;base64,AAAA" }] }],
        [`${path}/reports/reporter_user_target`, { reporterUid: "reporter", reason: "harassment" }]
      ];
      entries.push(...descendants);
      descendants.forEach(([descendantPath]) => expectedDeletedPaths.add(descendantPath));
    }
  }
  await putMany(db, entries);

  const adapter = makeAdapter("complete");
  const originalRemoveProfileBarrier = adapter.removeProfileBarrier.bind(adapter);
  adapter.removeProfileBarrier = async (...parameters) => {
    assert.equal((await db.doc("usernames/target_name").get()).exists, true,
      "the current holder reservation survives the first destructive sweep");
    await originalRemoveProfileBarrier(...parameters);
    assert.equal((await db.doc("usernames/target_name").get()).exists, true,
      "the reservation remains after the profile barrier");
    await putMany(db, [
      ["follows/after-profile-barrier", { followerId: "target", followingId: "other" }],
      ["usernames/recreated-after-barrier", { uid: "target", username: "recreated-after-barrier" }]
    ]);
    expectedDeletedPaths.add("follows/after-profile-barrier");
    expectedDeletedPaths.add("usernames/recreated-after-barrier");
  };
  const originalSecondSweep = adapter.secondSweep.bind(adapter);
  let inSecondSweep = false;
  adapter.secondSweep = async (...parameters) => {
    inSecondSweep = true;
    try {
      const result = await originalSecondSweep(...parameters);
      assert.equal((await db.doc("usernames/target_name").get()).exists, true,
        "the reservation remains until the second destructive sweep completes");
      return result;
    } finally { inSecondSweep = false; }
  };
  const originalDeleteRefs = adapter.deleteRefs.bind(adapter);
  let injectedBehindCursor = false;
  adapter.deleteRefs = async (...parameters) => {
    const refs = parameters[2];
    await originalDeleteRefs(...parameters);
    if (inSecondSweep && !injectedBehindCursor && refs.some((reference) => reference.path.startsWith("follows/"))) {
      injectedBehindCursor = true;
      await db.doc("follows/000-behind-cursor").set({ followerId: "target", followingId: "other" });
      expectedDeletedPaths.add("follows/000-behind-cursor");
    }
  };
  const logEntries = [];
  const logger = { info: (code) => logEntries.push(code), error: (code) => logEntries.push(code) };
  const result = await runDeletionProcessor({ adapter, ownerId: "complete-worker", logger });
  assert.deepEqual(result, { inspected: 1, processed: 1, failed: 0, skipped: 0, purged: 0 }, JSON.stringify(logEntries));
  assert.equal(injectedBehindCursor, true);
  assert.deepEqual(deletedUsers, ["target"]);
  assert.equal((await db.doc("system/accountStats").get()).data().count, 1);
  for (const path of expectedDeletedPaths) assert.equal((await db.doc(path).get()).exists, false, `${path} survived cleanup`);
  for (const path of priorHolderPaths) assert.equal((await db.doc(path).get()).exists, true,
    `${path} from the prior username holder was deleted`);
  const remainingReservations = await db.collection("usernames").where("uid", "==", "target").get();
  assert.equal(remainingReservations.empty, true);
  const marker = (await db.doc("adminDeletionJobs/target").get()).data();
  assert.equal(isExactCompletionMarker(marker), true);
  assert.equal(marker.purgeAfter.toMillis() - marker.completedAt.toMillis(), COMPLETION_RETENTION_MS);
  assert.deepEqual((await db.doc("system/deletionProcessor").get()).data().status, "completed");
  assert.ok(logEntries.every((entry) => /^[A-Z0-9_]+$/.test(entry)));

  const retainedLogs = [];
  const retained = await runDeletionProcessor({
    adapter,
    ownerId: "second-run",
    logger: { info: (code) => retainedLogs.push(code), error: (code) => retainedLogs.push(code) }
  });
  assert.equal(retained.purged, 0);
  assert.equal(retainedLogs.includes("MALFORMED_MARKER"), false);
}

// Failed, stale-processing, active-processing, auth-deleted, and malformed jobs/markers coexist safely.
{
  const missingAuthCalls = [];
  const auth = {
    async deleteUser(uid) {
      missingAuthCalls.push(uid);
      if (uid === "failed-auth") throw Object.assign(new Error("missing"), { code: "auth/user-not-found" });
    }
  };
  const { db, clock, makeAdapter } = scenario({ auth });
  const completedAt = clock.now - COMPLETION_RETENTION_MS - 100;
  await putMany(db, [
    ...administratorEntries(),
    ["adminDeletionJobs/failed-auth", internalJob("failed-auth", clock.now, { status: "failed", phase: "auth-deleting" })],
    ["adminDeletionJobs/stale-barrier", internalJob("stale-barrier", clock.now, { phase: "profile-barrier" })],
    ["adminDeletionJobs/stale-auth-deleted", internalJob("stale-auth-deleted", clock.now, { phase: "auth-deleted" })],
    ["adminDeletionJobs/active-processing", internalJob("active-processing", clock.now, { phase: "profile-barrier", leaseExpiresAt: clock.now + LEASE_MS })],
    ["adminDeletionJobs/malformed-job", { ...queuedJob("malformed-job", clock.now), extra: "blocked" }],
    ["adminDeletionJobs/expired-marker", {
      status: "completed",
      completedAt: Timestamp.fromMillis(completedAt),
      purgeAfter: Timestamp.fromMillis(completedAt + COMPLETION_RETENTION_MS)
    }],
    ["adminDeletionJobs/retained-marker", {
      status: "completed",
      completedAt: Timestamp.fromMillis(clock.now),
      purgeAfter: Timestamp.fromMillis(clock.now + COMPLETION_RETENTION_MS)
    }],
    ["adminDeletionJobs/malformed-marker", {
      status: "completed",
      completedAt: Timestamp.fromMillis(completedAt),
      purgeAfter: Timestamp.fromMillis(completedAt + COMPLETION_RETENTION_MS),
      extra: "blocked"
    }]
  ]);
  const entries = [];
  const result = await runDeletionProcessor({
    adapter: makeAdapter("matrix"),
    ownerId: "matrix-worker",
    logger: { info: (code) => entries.push(code), error: (code) => entries.push(code) }
  });
  assert.deepEqual(result, { inspected: 5, processed: 3, failed: 1, skipped: 1, purged: 1 });
  assert.equal((await db.doc("adminDeletionJobs/expired-marker").get()).exists, false);
  assert.equal((await db.doc("adminDeletionJobs/retained-marker").get()).exists, true);
  assert.equal((await db.doc("adminDeletionJobs/malformed-marker").get()).exists, true);
  assert.equal((await db.doc("adminDeletionJobs/active-processing").get()).data().status, "processing");
  assert.equal((await db.doc("adminDeletionJobs/malformed-job").get()).data().extra, "blocked");
  for (const uid of ["failed-auth", "stale-barrier", "stale-auth-deleted"]) {
    assert.equal(isExactCompletionMarker((await db.doc(`adminDeletionJobs/${uid}`).get()).data()), true);
  }
  assert.deepEqual(missingAuthCalls.sort(), ["failed-auth", "stale-barrier"]);
  assert.equal(entries.includes("MALFORMED_MARKER"), true);
  assert.equal(entries.includes("INVALID_JOB"), true);
  assert.ok(entries.every((entry) => /^[A-Z0-9_]+$/.test(entry)));
}

// Heartbeat failure is isolated from the real Firestore state machine and finalization.
{
  const { db, clock, makeAdapter } = scenario();
  await putMany(db, [
    ...administratorEntries(),
    ["adminDeletionJobs/heartbeat-target", internalJob("heartbeat-target", clock.now, { phase: "auth-deleted" })]
  ]);
  const adapter = makeAdapter("heartbeat");
  adapter.heartbeat = async () => { throw new Error("emulator heartbeat outage"); };
  const entries = [];
  const result = await runDeletionProcessor({
    adapter,
    ownerId: "heartbeat-worker",
    logger: { info: (code) => entries.push(code), error: (code) => entries.push(code) }
  });
  assert.equal(result.processed, 1);
  assert.equal(isExactCompletionMarker((await db.doc("adminDeletionJobs/heartbeat-target").get()).data()), true);
  assert.equal(entries.filter((entry) => entry === "HEARTBEAT_ERROR").length, 2);
  assert.ok(entries.every((entry) => /^[A-Z0-9_]+$/.test(entry)));
}

// A profile recreated before alias pagination fails without deleting its reservation, then retries idempotently.
{
  const { db, clock, makeAdapter } = scenario();
  await putMany(db, [
    ["adminDeletionJobs/profile-race", internalJob("profile-race", clock.now, { phase: "auth-deleted", leaseExpiresAt: clock.now + LEASE_MS })],
    ["users/profile-race", { uid: "profile-race", username: "recreated", banned: false }],
    ["usernames/recreated", { uid: "profile-race", username: "recreated" }]
  ]);
  const adapter = makeAdapter("profile-race");
  const completedAt = Timestamp.fromMillis(clock.now), purgeAfter = Timestamp.fromMillis(clock.now + COMPLETION_RETENTION_MS);
  await assert.rejects(adapter.finalize("profile-race", "old-token", completedAt, purgeAfter), (error) => error.code === "profile-recreated");
  assert.equal((await db.doc("usernames/recreated").get()).exists, true, "a recreated profile keeps its username reservation");
  assert.equal((await db.doc("adminDeletionJobs/profile-race").get()).data().status, "processing");
  await db.doc("users/profile-race").delete();
  await adapter.finalize("profile-race", "old-token", completedAt, purgeAfter);
  assert.equal((await db.doc("usernames/recreated").get()).exists, false);
  assert.equal(isExactCompletionMarker((await db.doc("adminDeletionJobs/profile-race").get()).data()), true);
}

// Completion has no observable gap in which an alias can be inserted after an empty page but before the marker.
{
  const { db, clock, makeAdapter } = scenario();
  await putMany(db, [[
    "adminDeletionJobs/late-alias", internalJob("late-alias", clock.now, { phase: "auth-deleted", leaseExpiresAt: clock.now + LEASE_MS })
  ]]);
  const adapter = makeAdapter("late-alias");
  const firestore = adapter.db, runTransaction = firestore.runTransaction.bind(firestore);
  let lateAliasInserted = false;
  adapter.db = new Proxy(firestore, {
    get(target, property) {
      if (property === "runTransaction") return async (updateFunction) => {
        const result = await runTransaction(updateFunction);
        const job = await firestore.doc("adminDeletionJobs/late-alias").get();
        if (!lateAliasInserted && job.data()?.status === "processing" && job.data()?.phase === "auth-deleted") {
          lateAliasInserted = true;
          await firestore.doc("usernames/late-alias-race").set({ uid: "late-alias", username: "late_alias_race" });
        }
        return result;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  await adapter.finalize(
    "late-alias", "old-token", Timestamp.fromMillis(clock.now), Timestamp.fromMillis(clock.now + COMPLETION_RETENTION_MS)
  );
  assert.equal(lateAliasInserted, false, "the zero-alias check cannot commit before the completion marker");
  assert.equal((await db.collection("usernames").where("uid", "==", "late-alias").get()).empty, true);
  assert.equal(isExactCompletionMarker((await db.doc("adminDeletionJobs/late-alias").get()).data()), true);
}

// Auth-deleted retries remove every username reservation in bounded pages, including more than one legacy page.
{
  const { db, clock, makeAdapter } = scenario();
  const reservations = Array.from({ length: PAGE_LIMIT * 2 + 5 }, (_, index) => [
    `usernames/legacy-${String(index).padStart(3, "0")}`,
    { uid: "many-names", username: `legacy_${index}` }
  ]);
  await putMany(db, [
    ...administratorEntries(),
    ["adminDeletionJobs/many-names", internalJob("many-names", clock.now, { phase: "auth-deleted" })],
    ...reservations
  ]);
  const result = await runDeletionProcessor({ adapter: makeAdapter("many-names"), ownerId: "many-names-worker", logger: { info() {}, error() {} } });
  assert.equal(result.processed, 1);
  assert.equal((await db.collection("usernames").where("uid", "==", "many-names").get()).empty, true);
  assert.equal(isExactCompletionMarker((await db.doc("adminDeletionJobs/many-names").get()).data()), true);
}

// A legacy self job whose request anchor was removed remains safely authorized by its exact self identity and target profile.
{
  const { db, clock, deletedUsers, makeAdapter } = scenario();
  const requestedAt = Timestamp.fromMillis(clock.now - 10_000);
  await putMany(db, [
    ["adminDeletionJobs/anchorless", { targetUid: "anchorless", requesterUid: "anchorless", requestedAt, requestType: "self", status: "queued" }],
    ["users/anchorless", { uid: "anchorless", username: "anchorless_name", banned: false }],
    ["usernames/anchorless_name", { uid: "anchorless", username: "anchorless_name" }],
    ["system/accountStats", { count: 1, limit: 500, updatedAt: Timestamp.fromMillis(clock.now - 1) }]
  ]);
  const result = await runDeletionProcessor({ adapter: makeAdapter("anchorless"), ownerId: "anchorless-worker", logger: { info() {}, error() {} } });
  assert.equal(result.processed, 1);
  assert.deepEqual(deletedUsers, ["anchorless"]);
  assert.equal(isExactCompletionMarker((await db.doc("adminDeletionJobs/anchorless").get()).data()), true);
}

// A public self request is trusted only for its own account and cascades hidden/visible data, descendants, rooms, blocks, profile, and Auth.
{
  const { db, clock, deletedUsers, makeAdapter } = scenario();
  const requestedAt = Timestamp.fromMillis(clock.now - 10_000);
  await putMany(db, [
    ["adminDeletionJobs/self", { targetUid: "self", requesterUid: "self", requestedAt, requestType: "self", status: "queued" }],
    ["accountDeletionRequests/self", { uid: "self", username: "self_name", createdAt: requestedAt }],
    ["users/self", { uid: "self", username: "self_name", banned: false }],
    ["usernames/self_name", { uid: "self", username: "self_name" }],
    ["system/accountStats", { count: 1, limit: 500, updatedAt: Timestamp.fromMillis(clock.now - 1) }],
    ["posts/visible", { authorId: "self", moderationState: "visible" }],
    ["posts/visible/comments/comment", { uid: "other" }],
    ["posts/visible/comments/comment/replies/reply", { uid: "other" }],
    ["posts/hidden", { authorId: "self", moderationState: "hidden" }],
    ["posts/hidden/reactions/reaction", { uid: "other" }],
    ["rooms/active", { ownerId: "self", expiresAt: Timestamp.fromMillis(clock.now + 60_000) }],
    ["roomMessages/active-message", { roomId: "active", senderId: "other" }],
    ["roomMembers/active-self", { roomId: "active", uid: "self" }],
    ["blocks/self_other", { blockerUid: "self", blockedUid: "other" }],
    ["blocks/other_self", { blockerUid: "other", blockedUid: "self" }],
    ["reportIntakes/self_post_other", { reporterUid: "self", reportedUserId: "other" }],
    ["moderationCases/post_self", { reportedUserId: "self" }],
    ["moderationCases/post_self/reports/report", { reporterUid: "other" }],
    ["moderationActions/post_self", { action: "deleteMaterial", status: "queued" }]
  ]);
  const result = await runDeletionProcessor({ adapter: makeAdapter("self"), ownerId: "self-worker", logger: { info() {}, error() {} } });
  assert.equal(result.processed, 1);
  for (const path of [
    "accountDeletionRequests/self", "users/self", "usernames/self_name", "posts/visible", "posts/visible/comments/comment",
    "posts/visible/comments/comment/replies/reply", "posts/hidden", "posts/hidden/reactions/reaction", "rooms/active",
    "roomMessages/active-message", "roomMembers/active-self", "blocks/self_other", "blocks/other_self",
    "reportIntakes/self_post_other", "moderationCases/post_self", "moderationCases/post_self/reports/report", "moderationActions/post_self"
  ]) assert.equal((await db.doc(path).get()).exists, false, `${path} is deleted by self cascade`);
  assert.deepEqual(deletedUsers, ["self"]);
  assert.equal((await db.doc("system/accountStats").get()).data().count, 0);
  assert.equal(isExactCompletionMarker((await db.doc("adminDeletionJobs/self").get()).data()), true);
}

await Promise.all(apps.map((app) => deleteApp(app)));
console.log("Administrator deletion production Firestore integration passed");
