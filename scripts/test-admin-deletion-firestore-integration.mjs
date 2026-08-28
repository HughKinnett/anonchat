import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldPath, Timestamp, getFirestore } from "firebase-admin/firestore";
import { FirestoreDeletionAdapter } from "../admin-deletion-firestore-adapter.mjs";
import { LEASE_MS } from "../admin-deletion-processor-policy.mjs";
import { scanPages } from "../admin-deletion-processor.mjs";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator is required");

const apps = [];
let scenarioNumber = 0;
const scenario = ({ now = 1_800_000_000_000, auth } = {}) => {
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
    tokenFactory: () => `${ownerPrefix}-token-${++tokenNumber}`
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

const putMany = async (db, entries) => {
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch();
    for (const [path, value] of entries.slice(offset, offset + 400)) batch.set(db.doc(path), value);
    await batch.commit();
  }
};

// Stable document-name cursors must reach work behind more than one full page.
{
  const { db, makeAdapter } = scenario();
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
    ["adminDeletionJobs/z-queued", { status: "queued" }],
    ...frontMarkers,
    ["adminDeletionJobs/z-marker", { status: "completed" }]
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

// Any reservation for the target UID, including a trusted recreation race, blocks completion.
{
  const { db, clock, makeAdapter } = scenario();
  await putMany(db, [
    ["adminDeletionJobs/target", processingJob({ phase: "auth-deleted", now: clock.now })],
    ["usernames/recreated_name", { uid: "target", username: "recreated_name" }]
  ]);
  await assert.rejects(
    makeAdapter().finalize(
      "target",
      "worker-token",
      Timestamp.fromMillis(clock.now),
      Timestamp.fromMillis(clock.now + 1_000)
    ),
    (error) => error.code === "profile-recreated"
  );
  assert.equal((await db.doc("adminDeletionJobs/target").get()).data().status, "processing");
}

// The external Auth boundary is lease-owned, renewable, and safely reclaimable after expiry.
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
    first.finishAuthDeletion("target", "worker-token"),
    (error) => error.code === "lease-lost"
  );
  await second.beginAuthDeletion("target", claimed.token);
  await second.deleteAuth("target");
  await second.finishAuthDeletion("target", claimed.token);
  stored = (await db.doc("adminDeletionJobs/target").get()).data();
  assert.equal(stored.phase, "auth-deleted");
  assert.deepEqual(deletedUsers, ["target"]);
}

await Promise.all(apps.map((app) => deleteApp(app)));
console.log("Administrator deletion production Firestore integration passed");
