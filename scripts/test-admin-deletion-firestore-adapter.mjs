import assert from "node:assert/strict";
import { boundedDeleteQuery } from "../admin-deletion-firestore-adapter.mjs";
const remaining = new Set(Array.from({ length: 450 }, (_, index) => `posts/${String(index).padStart(4, "0")}`));
const fetchLimits = []; const batchSizes = []; let fetches = 0; let renewals = 0;
const deleted = await boundedDeleteQuery({
  fetchPage: async ({ afterPath, limit }) => {
    fetchLimits.push(limit);
    const page = [...remaining].sort().filter((path) => !afterPath || path > afterPath).slice(0, limit);
    fetches += 1; if (fetches === 2) remaining.add("posts/-late-behind-cursor");
    return page.map((path) => ({ path }));
  },
  deleteRefs: async (refs) => { batchSizes.push(refs.length); refs.forEach((ref) => remaining.delete(ref.path)); },
  renewLease: async () => { renewals += 1; }
});
assert.equal(deleted, 451); assert.equal(remaining.size, 0);
assert.ok(fetchLimits.every((limit) => limit <= 200)); assert.ok(batchSizes.every((size) => size <= 400));
assert.ok(renewals >= batchSizes.length);
await assert.rejects(() => boundedDeleteQuery({
  fetchPage: async () => [{ path: "same/path" }], deleteRefs: async () => {}, renewLease: async () => {}, maxPasses: 2, maxPages: 2
}), (error) => error.code === "cleanup-limit");
console.log("Administrator deletion Firestore adapter bounds passed");
