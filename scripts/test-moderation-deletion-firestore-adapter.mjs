import assert from "node:assert/strict";
import { boundedDeleteQuery } from "../moderation-deletion-firestore-adapter.mjs";

const remaining = new Set(Array.from({ length: 805 }, (_, index) => `roomMessages/${String(index).padStart(4, "0")}`));
const fetchLimits = [];
const batchSizes = [];
let fetches = 0;
const deleted = await boundedDeleteQuery({
  fetchPage: async ({ afterPath, limit }) => {
    fetchLimits.push(limit);
    const page = [...remaining].sort().filter(path => !afterPath || path > afterPath).slice(0, limit);
    fetches += 1;
    if (fetches === 2) remaining.add("roomMessages/-late-behind-cursor");
    return page.map(path => ({ path }));
  },
  deleteRefs: async refs => {
    batchSizes.push(refs.length);
    refs.forEach(ref => remaining.delete(ref.path));
  },
  renewLease: async () => {}
});

assert.equal(deleted, 806);
assert.equal(remaining.size, 0);
assert.ok(fetchLimits.every(value => value <= 200));
assert.ok(batchSizes.every(value => value <= 400));

console.log("Moderation deletion Firestore adapter bounds passed");
