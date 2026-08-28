import assert from "node:assert/strict";
import {
  isCompleteLegacyProfile,
  migrateLegacyProfile
} from "../legacy-migration-policy.mjs";

const timestamp = () => ({ toMillis: () => 1 });
const serverTimestamp = () => ({ serverTimestamp: true });
const complete = {
  uid: "user-a",
  username: "user_a",
  createdAt: timestamp(),
  lastActiveAt: timestamp()
};

assert.equal(isCompleteLegacyProfile(complete, "user-a", "user_a"), true, "complete profiles need no repair");
assert.equal(
  isCompleteLegacyProfile({ ...complete, lastActiveAt: undefined }, "user-a", "user_a"),
  false,
  "a uid/username-only profile with no trusted activity timestamp needs repair"
);
assert.equal(
  isCompleteLegacyProfile({ ...complete, createdAt: "untrusted" }, "user-a", "user_a"),
  false,
  "an untrusted createdAt value needs repair"
);

const repaired = migrateLegacyProfile({
  profile: { uid: "user-a", username: "user_a", createdAt: timestamp() },
  uid: "user-a",
  username: "user_a",
  serverTimestamp
});
assert.equal(repaired.createdAt.toMillis(), 1, "a trusted existing createdAt is preserved");
assert.deepEqual(repaired.lastActiveAt, { serverTimestamp: true }, "a missing activity timestamp uses the trusted server timestamp");

const created = migrateLegacyProfile({ profile: {}, uid: "user-a", username: "user_a", serverTimestamp });
assert.deepEqual(created, {
  uid: "user-a",
  username: "user_a",
  createdAt: { serverTimestamp: true },
  lastActiveAt: { serverTimestamp: true }
}, "a created legacy profile receives both trusted timestamps");

console.log("legacy migration policy passed");
