import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadBadgeReconciliationCursor, saveBadgeReconciliationCursor } from "../badge-reconciliation-state.mjs";

const stored = {};
const fakeDb = {
  collection(name) {
    assert.equal(name, "systemState");
    return {
      doc(id) {
        assert.equal(id, "badgeReconciliation");
        return {
          async get() {
            return { exists: true, data: () => ({ ...stored }) };
          },
          async set(value, options) {
            assert.deepEqual(options, { merge: true });
            Object.assign(stored, value);
          }
        };
      }
    };
  }
};

assert.equal(await loadBadgeReconciliationCursor({ db: fakeDb, kind: "identity" }), null);
await saveBadgeReconciliationCursor({ db: fakeDb, kind: "identity", cursor: "u100" });
assert.equal(await loadBadgeReconciliationCursor({ db: fakeDb, kind: "identity" }), "u100");
await saveBadgeReconciliationCursor({ db: fakeDb, kind: "activity", cursor: "u25" });
assert.equal(await loadBadgeReconciliationCursor({ db: fakeDb, kind: "activity" }), "u25");
await saveBadgeReconciliationCursor({ db: fakeDb, kind: "identity", cursor: null });
assert.equal(await loadBadgeReconciliationCursor({ db: fakeDb, kind: "identity" }), null, "end-of-pass resets the cursor so a future cycle starts over");
assert.equal(stored.activityCursor, "u25", "updating one cursor leaves the other cursor intact");

await assert.rejects(() => loadBadgeReconciliationCursor({ db: fakeDb, kind: "unknown" }), /badge reconciliation kind/i);
await assert.rejects(() => saveBadgeReconciliationCursor({ db: fakeDb, kind: "unknown", cursor: null }), /badge reconciliation kind/i);

const [identityProcessor, activityProcessor] = await Promise.all([
  readFile(new URL("./badge-account-age-processor.mjs", import.meta.url), "utf8"),
  readFile(new URL("./badge-activity-processor.mjs", import.meta.url), "utf8")
]);
for (const [label, source, kind] of [
  ["identity", identityProcessor, "identity"],
  ["activity", activityProcessor, "activity"]
]) {
  assert.match(source, /loadBadgeReconciliationCursor/, `${label} processor loads its saved cursor`);
  assert.match(source, /saveBadgeReconciliationCursor/, `${label} processor saves its next cursor`);
  assert.match(source, new RegExp(`kind:\\s*["']${kind}["']`), `${label} processor uses the correct state field`);
  assert.match(source, /startCursor/, `${label} processor passes the saved cursor into reconciliation`);
  assert.match(source, /nextCursor/, `${label} processor persists the cursor returned by reconciliation`);
}

console.log("Badge reconciliation cursor state contract passed.");
