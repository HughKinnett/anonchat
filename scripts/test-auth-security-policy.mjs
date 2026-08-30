import assert from "node:assert/strict";
import { clearFailures, failureState, isDesignatedAdmin, recordInvalidCredential } from "../auth-security-policy.mjs";

const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
assert.deepEqual(failureState(storage, "USER@example.com"), { count: 0, resetRequired: false });
assert.equal(recordInvalidCredential(storage, "user@example.com").count, 1);
assert.equal(recordInvalidCredential(storage, "USER@example.com").count, 2);
assert.deepEqual(recordInvalidCredential(storage, "user@example.com"), { count: 3, resetRequired: true });
clearFailures(storage, "user@example.com");
assert.deepEqual(failureState(storage, "user@example.com"), { count: 0, resetRequired: false });
assert.equal(isDesignatedAdmin("i_love_you_h"), true);
assert.equal(isDesignatedAdmin("CyberCapone"), true);
assert.equal(isDesignatedAdmin("OwnerCyberCapone"), false);
