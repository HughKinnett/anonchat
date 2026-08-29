import assert from "node:assert/strict";
import { main } from "./deletion-processors.mjs";

const calls = [];
const success = await main([], {
  runAccount: async argumentsList => { calls.push(["account", argumentsList]); return { processed: 2 }; },
  runModeration: async argumentsList => { calls.push(["moderation", argumentsList]); return { processed: 3 }; }
});
assert.deepEqual(calls, [["account", []], ["moderation", []]]);
assert.deepEqual(success, {
  ok: true,
  account: { ok: true, result: { processed: 2 } },
  moderation: { ok: true, result: { processed: 3 } }
});

const failureCalls = [];
const partial = await main(["--dry-run"], {
  runAccount: async argumentsList => {
    failureCalls.push(["account", argumentsList]);
    throw new Error("account failed");
  },
  runModeration: async argumentsList => {
    failureCalls.push(["moderation", argumentsList]);
    return { processed: 1 };
  }
});
assert.deepEqual(failureCalls, [
  ["account", ["--dry-run"]],
  ["moderation", ["--dry-run"]]
], "the moderation worker still runs when account deletion fails");
assert.equal(partial.ok, false);
assert.equal(partial.account.ok, false);
assert.equal(partial.moderation.ok, true);

console.log("Consolidated deletion processor CLI passed");
