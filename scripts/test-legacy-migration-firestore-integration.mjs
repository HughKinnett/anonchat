import assert from "node:assert/strict";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { migrateLegacyAccount } from "../legacy-migration-firestore-adapter.mjs";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Firestore emulator is required");
const app = initializeApp({ projectId: "anonchat-legacy-migration-integration" }, "legacy-migration-integration");
const db = getFirestore(app);
const migrate = (user, protectedUidMap = {}) => migrateLegacyAccount({ db, FieldValue, user, protectedUidMap });

await db.doc("system/accountStats").set({ count: 5, limit: 500, updatedAt: new Date(0) });
const extended = {
  uid: "existing-user",
  username: "existing_user",
  createdAt: new Date(1),
  banned: true,
  adminDeletionStatus: "queued",
  adminDeletionRequestedBy: "administrator",
  adminDeletionRequestedAt: new Date(2),
  profileImage: "data:image/png;base64,extended",
  spotifyTrackUrl: "https://open.spotify.com/track/1234567890123456789012",
  futureField: { retained: true }
};
await db.doc("users/existing-user").set(extended);
await db.doc("usernames/existing_user").set({ uid: "existing-user", username: "existing_user", createdAt: new Date(1) });
const storedExtended = (await db.doc("users/existing-user").get()).data();
assert.deepEqual(await migrate({ uid: "existing-user", displayName: "ignored_display_name" }), {
  username: "existing_user",
  existed: true,
  changed: false
});
const preserved = (await db.doc("users/existing-user").get()).data();
assert.deepEqual(preserved, storedExtended, "migration preserves every stored live field and security state");
assert.equal(Object.hasOwn(preserved, "lastActiveAt"), false, "missing activity remains Activity Not Recorded");
assert.equal((await db.doc("system/accountStats").get()).data().count, 5, "existing repair never changes accountStats");

const repairSecurityState = {
  banned: true,
  adminDeletionStatus: "queued",
  adminDeletionRequestedBy: "administrator",
  adminDeletionRequestedAt: new Date(3),
  futureField: { retained: "during repair" }
};
await db.doc("users/repair-user").set({
  uid: "stale-uid",
  username: "repair_user",
  createdAt: "untrusted",
  ...repairSecurityState
});
await db.doc("usernames/repair_user").set({ uid: "repair-user", username: "repair_user", createdAt: new Date(1) });
assert.deepEqual(await migrate({ uid: "repair-user", displayName: "ignored_name" }), {
  username: "repair_user",
  existed: true,
  changed: true
});
const repaired = (await db.doc("users/repair-user").get()).data();
assert.equal(repaired.uid, "repair-user");
assert.equal(typeof repaired.createdAt.toMillis, "function");
assert.equal(Object.hasOwn(repaired, "lastActiveAt"), false, "repair does not invent activity history");
for (const [field, value] of Object.entries(repairSecurityState)) {
  if (field.endsWith("At")) {
    assert.equal(repaired[field].toMillis(), value.getTime(), `${field} survives the transactional repair`);
  } else {
    assert.deepEqual(repaired[field], value, `${field} survives the transactional repair`);
  }
}
assert.equal((await db.doc("system/accountStats").get()).data().count, 5,
  "repairing an existing profile does not increment accountStats");

const created = await migrate({ uid: "new-user", displayName: "new_user" });
assert.deepEqual(created, { username: "new_user", existed: false, changed: true });
const newProfile = (await db.doc("users/new-user").get()).data();
assert.equal(newProfile.uid, "new-user");
assert.equal(newProfile.username, "new_user");
assert.equal(typeof newProfile.createdAt.toMillis, "function");
assert.equal(typeof newProfile.lastActiveAt.toMillis, "function");
assert.equal((await db.doc("usernames/new_user").get()).data().uid, "new-user");
assert.equal((await db.doc("system/accountStats").get()).data().count, 6,
  "new profile and accountStats increment commit together");

const assertNormalizedProtectedProfile = async ({ uid, username, key }) => {
  const profileRef = db.doc(`users/${uid}`);
  const reservationRef = db.doc(`usernames/${key}`);
  const storedProfile = {
    uid,
    username,
    createdAt: new Date(4),
    banned: true,
    futureField: { retained: key }
  };
  const storedReservation = { uid, username, createdAt: new Date(4) };
  await profileRef.set(storedProfile);
  await reservationRef.set(storedReservation);
  const profileBefore = (await profileRef.get()).data();
  const reservationBefore = (await reservationRef.get()).data();
  const statsBefore = (await db.doc("system/accountStats").get()).data();

  for (const protectedUidMap of [{}, { [key]: "wrong-protected-uid" }]) {
    await assert.rejects(
      () => migrate({ uid }, protectedUidMap),
      (error) => error.code === "protected-uid-mapping-required"
    );
    assert.deepEqual((await profileRef.get()).data(), profileBefore,
      `${key} attestation failure leaves the protected profile unchanged`);
    assert.deepEqual((await reservationRef.get()).data(), reservationBefore,
      `${key} attestation failure leaves its exact reservation unchanged`);
    assert.deepEqual((await db.doc("system/accountStats").get()).data(), statsBefore,
      `${key} attestation failure leaves accountStats unchanged`);
    assert.equal((await db.doc(`usernames/anon_${uid.slice(0, 8)}`).get()).exists, false,
      `${key} attestation failure creates no ordinary anon reservation`);
    assert.equal((await db.doc(`usernames/u_${uid}`).get()).exists, false,
      `${key} attestation failure creates no ordinary fallback reservation`);
  }

  assert.deepEqual(await migrate({ uid }, { [key]: uid }), {
    username,
    existed: true,
    changed: false
  });
  assert.deepEqual((await profileRef.get()).data(), profileBefore,
    `${key} correct attestation preserves the normalized protected spelling and security state`);
  assert.deepEqual((await reservationRef.get()).data(), reservationBefore,
    `${key} correct attestation preserves the matching canonical reservation`);
  assert.equal((await db.doc(`usernames/anon_${uid.slice(0, 8)}`).get()).exists, false,
    `${key} correct attestation cannot demote to an ordinary anon reservation`);
  assert.equal((await db.doc(`usernames/u_${uid}`).get()).exists, false,
    `${key} correct attestation cannot create a stray fallback reservation`);

  await profileRef.delete();
  await reservationRef.delete();
};

await assertNormalizedProtectedProfile({
  uid: "nbspCyberAdmin",
  username: "\u00a0CyberCapone\u00a0",
  key: "cybercapone"
});
await assertNormalizedProtectedProfile({
  uid: "bomLoveAdmin",
  username: "\uFEFFi_love_you_h\uFEFF",
  key: "i_love_you_h"
});

await assert.rejects(
  () => migrate({ uid: "unmapped-protected", displayName: "i_love_you_h" }),
  (error) => error.code === "protected-uid-mapping-required"
);
assert.equal((await db.doc("users/unmapped-protected").get()).exists, false);
assert.equal((await db.doc("usernames/i_love_you_h").get()).exists, false);
assert.equal((await db.doc("system/accountStats").get()).data().count, 6);

await migrate(
  { uid: "mapped-protected", displayName: "CyberCapone" },
  { cybercapone: "mapped-protected" }
);
assert.equal((await db.doc("users/mapped-protected").get()).data().username, "CyberCapone");
assert.equal((await db.doc("usernames/cybercapone").get()).data().uid, "mapped-protected");
assert.equal((await db.doc("system/accountStats").get()).data().count, 7);

await migrate({ uid: "former-handle-user", displayName: "OwnerCyberCapone" });
assert.equal((await db.doc("users/former-handle-user").get()).data().username, "OwnerCyberCapone");
assert.equal((await db.doc("usernames/ownercybercapone").get()).data().uid, "former-handle-user");
assert.equal((await db.doc("system/accountStats").get()).data().count, 8,
  "the former handle is created only as an ordinary account");

for (const [uid, barrierPath] of [
  ["adminBarrierUser", "adminDeletionJobs/adminBarrierUser"],
  ["selfBarrierUser", "accountDeletionRequests/selfBarrierUser"]
]) {
  await db.doc(barrierPath).set({ status: "queued" });
  const statsBefore = (await db.doc("system/accountStats").get()).data();
  await assert.rejects(
    () => migrate({ uid, displayName: `user_${uid}` }),
    (error) => error.code === "account-deletion-in-progress"
  );
  assert.equal((await db.doc(`users/${uid}`).get()).exists, false,
    `${barrierPath} prevents privileged profile recreation`);
  assert.equal((await db.doc(`usernames/user_${uid}`.toLowerCase()).get()).exists, false,
    `${barrierPath} prevents a replacement reservation`);
  assert.deepEqual((await db.doc("system/accountStats").get()).data(), statsBefore,
    `${barrierPath} prevents accountStats drift`);
}

await deleteApp(app);
console.log("legacy migration Firestore transaction passed");
