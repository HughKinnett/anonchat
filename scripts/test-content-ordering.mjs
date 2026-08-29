import assert from "node:assert/strict";
import * as contentOrdering from "../content-ordering.mjs";

const {
  canonicalRecordPath,
  compareNewestFirst,
  compareOldestFirst
} = contentOrdering;

const record = (path, createdAt, { pending = false } = {}) => ({
  ref: { path },
  data: () => ({ createdAt }),
  metadata: { hasPendingWrites: pending }
});
const early = record("posts/early", 100);
const late = record("posts/late", { toMillis: () => 200 });
const equalPathA = record("posts/a", new Date(300));
const equalPathB = record("posts/b", 300);
const equalCommunityPost = record("communityPosts/a", 300);
const missingCanonicalPost = {
  id: "a",
  data: () => ({ createdAt: 300 }),
  metadata: { hasPendingWrites: false }
};
const missingCanonicalCommunityPost = {
  id: "a",
  data: () => ({ createdAt: 300 }),
  metadata: { hasPendingWrites: false }
};
const pending = record("posts/pending", null, { pending: true });
const missing = record("posts/missing", null);

assert.equal(Object.hasOwn(contentOrdering, "timestampMillis"), false);
for (const value of [NaN, Infinity, new Date("invalid"), { toMillis: () => NaN }, "789"]) {
  const invalid = record("posts/invalid", value);
  assert.deepEqual([invalid, late].sort(compareNewestFirst), [late, invalid]);
  assert.deepEqual([invalid, late].sort(compareOldestFirst), [late, invalid]);
}

assert.equal(canonicalRecordPath(equalPathA), "posts/a");
assert.equal(canonicalRecordPath({ path: "communityPosts/post-1" }), "communityPosts/post-1");
assert.throws(() => canonicalRecordPath(missingCanonicalPost), /canonical path/);
assert.deepEqual([late, early].sort(compareOldestFirst), [early, late]);
assert.deepEqual([early, late].sort(compareNewestFirst), [late, early]);
assert.deepEqual([equalPathB, equalPathA].sort(compareNewestFirst), [equalPathA, equalPathB]);
assert.deepEqual([equalPathB, equalPathA].sort(compareOldestFirst), [equalPathA, equalPathB]);
assert.deepEqual([equalPathA, equalCommunityPost].sort(compareNewestFirst), [equalCommunityPost, equalPathA]);
assert.throws(
  () => [missingCanonicalPost, missingCanonicalCommunityPost].sort(compareNewestFirst),
  /canonical path/
);
assert.deepEqual([pending, late].sort(compareNewestFirst), [late, pending]);
assert.deepEqual([late, pending].sort(compareOldestFirst), [pending, late]);
assert.deepEqual([missing, late].sort(compareNewestFirst), [late, missing]);
assert.deepEqual([missing, late].sort(compareOldestFirst), [late, missing]);

console.log("Content ordering passed");
