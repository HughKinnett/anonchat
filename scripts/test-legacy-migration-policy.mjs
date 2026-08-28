import assert from "node:assert/strict";
import {
  assertProtectedUidMapping,
  createLegacyProfile,
  isCompleteLegacyProfile,
  parseProtectedUidMap,
  repairLegacyProfile
} from "../legacy-migration-policy.mjs";

const timestamp = (milliseconds = 1) => ({ toMillis: () => milliseconds });
const serverTimestamp = () => ({ serverTimestamp: true });
const liveProfile = {
  uid: "user-a",
  username: "user_a",
  createdAt: timestamp(),
  banned: true,
  adminDeletionStatus: "queued",
  adminDeletionRequestedBy: "administrator",
  adminDeletionRequestedAt: timestamp(2),
  profileImage: "data:image/png;base64,extended",
  spotifyTrackUrl: "https://open.spotify.com/track/1234567890123456789012",
  futureField: { retained: true }
};

assert.equal(
  isCompleteLegacyProfile(liveProfile, "user-a", "user_a"),
  true,
  "an existing profile without activity history needs no fabricated activity repair"
);
assert.deepEqual(
  repairLegacyProfile({ profile: liveProfile, uid: "user-a", username: "user_a", serverTimestamp }),
  {},
  "a valid extended profile is left byte-for-byte untouched"
);

const repair = repairLegacyProfile({
  profile: { ...liveProfile, uid: "wrong", createdAt: "untrusted" },
  uid: "user-a",
  username: "user_a",
  serverTimestamp
});
assert.deepEqual(repair, {
  uid: "user-a",
  createdAt: { serverTimestamp: true }
}, "repair contains invariant fields only");
assert.equal(Object.hasOwn(repair, "lastActiveAt"), false, "missing activity remains unknown");
for (const securityField of ["banned", "adminDeletionStatus", "adminDeletionRequestedBy", "adminDeletionRequestedAt"]) {
  assert.equal(Object.hasOwn(repair, securityField), false, `${securityField} is never overwritten by repair`);
}

assert.deepEqual(createLegacyProfile({ uid: "new-user", username: "new_user", serverTimestamp }), {
  uid: "new-user",
  username: "new_user",
  createdAt: { serverTimestamp: true },
  lastActiveAt: { serverTimestamp: true }
}, "a genuinely new profile receives trusted creation and activity timestamps");

const protectedUidMap = parseProtectedUidMap(JSON.stringify({
  i_love_you_h: "protected-one-uid",
  CyberCapone: "protected-two-uid"
}));
assert.deepEqual(protectedUidMap, {
  i_love_you_h: "protected-one-uid",
  cybercapone: "protected-two-uid"
});
assert.doesNotThrow(() => assertProtectedUidMapping("ordinary_user", "ordinary-uid", {}));
assert.doesNotThrow(() => assertProtectedUidMapping("I_LOVE_YOU_H", "protected-one-uid", protectedUidMap));
assert.doesNotThrow(() => assertProtectedUidMapping("CyberCapone", "protected-two-uid", protectedUidMap));
assert.doesNotThrow(() => assertProtectedUidMapping("OwnerCyberCapone", "ordinary-uid", {}),
  "the former unclaimed handle does not require or confer protected mapping");
assert.throws(
  () => assertProtectedUidMapping("i_love_you_h", "wrong-uid", protectedUidMap),
  (error) => error.code === "protected-uid-mapping-required"
);
assert.throws(
  () => assertProtectedUidMapping("cybercapone", "protected-two-uid", {}),
  (error) => error.code === "protected-uid-mapping-required"
);
assert.throws(() => parseProtectedUidMap("not-json"), (error) => error.code === "invalid-protected-uid-map");
assert.throws(
  () => parseProtectedUidMap(JSON.stringify({ ordinary_user: "uid" })),
  (error) => error.code === "invalid-protected-uid-map"
);
assert.throws(
  () => parseProtectedUidMap(JSON.stringify({ ownercybercapone: "uid" })),
  (error) => error.code === "invalid-protected-uid-map",
  "the former handle cannot be attested as a protected identity"
);

console.log("legacy migration policy passed");
