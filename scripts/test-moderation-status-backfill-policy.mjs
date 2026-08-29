import assert from "node:assert/strict";
import {
  MAX_BACKFILL_BATCH_SIZE,
  planModerationStatusUpdate,
  runModerationStatusBackfill
} from "../moderation-status-backfill-policy.mjs";

assert.deepEqual(
  planModerationStatusUpdate({ type: "original", authorId: "legacy" }),
  { moderationStatus: "active" },
  "a legacy document with no stored status is selected"
);
for (const moderationStatus of ["active", "reported", null, "unknown"]) {
  assert.equal(
    planModerationStatusUpdate({ moderationStatus }),
    null,
    `an explicit ${String(moderationStatus)} status is preserved`
  );
}

const makeAdapter = (documentsByCollection) => {
  const commits = [];
  const scans = [];
  return {
    commits,
    scans,
    async scan(collectionName, afterId, limit) {
      scans.push({ collectionName, afterId, limit });
      const documents = documentsByCollection[collectionName] ?? [];
      const start = afterId == null
        ? 0
        : documents.findIndex(({ id }) => id === afterId) + 1;
      const page = documents.slice(start, start + limit);
      return {
        documents: page,
        nextCursor: page.length === limit ? page.at(-1).id : null
      };
    },
    async commit(updates) {
      commits.push(updates);
      for (const { document, patch } of updates) Object.assign(document.data, patch);
    }
  };
};

const dryRunAdapter = makeAdapter({
  posts: [
    { id: "legacy-post", data: { authorId: "legacy" } },
    { id: "active-post", data: { moderationStatus: "active" } }
  ],
  rooms: [
    { id: "legacy-room", data: { ownerId: "legacy" } },
    { id: "reported-room", data: { moderationStatus: "reported" } }
  ],
  communityPosts: [
    { id: "legacy-community", data: { authorId: "legacy" } }
  ]
});
assert.deepEqual(await runModerationStatusBackfill({ adapter: dryRunAdapter }), {
  mode: "dry-run",
  scanned: 5,
  eligible: 3,
  updated: 0,
  batches: 0
});
assert.deepEqual(dryRunAdapter.commits, [], "dry-run performs no writes");
assert.ok(
  dryRunAdapter.scans.every(({ limit }) => limit === MAX_BACKFILL_BATCH_SIZE),
  "the production scan page is bounded to the write limit"
);
assert.deepEqual(
  new Set(dryRunAdapter.scans.map(({ collectionName }) => collectionName)),
  new Set(["posts", "rooms", "communityPosts"]),
  "legacy community posts are included before active-only deployment queries"
);

const legacyPosts = Array.from({ length: MAX_BACKFILL_BATCH_SIZE + 5 }, (_, index) => ({
  id: `post-${String(index).padStart(3, "0")}`,
  data: { authorId: "legacy" }
}));
const applyAdapter = makeAdapter({ posts: legacyPosts, rooms: [], communityPosts: [] });
assert.deepEqual(await runModerationStatusBackfill({ adapter: applyAdapter, apply: true }), {
  mode: "apply",
  scanned: MAX_BACKFILL_BATCH_SIZE + 5,
  eligible: MAX_BACKFILL_BATCH_SIZE + 5,
  updated: MAX_BACKFILL_BATCH_SIZE + 5,
  batches: 2
});
assert.deepEqual(
  applyAdapter.commits.map((updates) => updates.length),
  [MAX_BACKFILL_BATCH_SIZE, 5],
  "writes are committed in batches no larger than 400"
);
assert.ok(
  applyAdapter.commits.flat().every(({ patch }) => patch.moderationStatus === "active"),
  "every selected document receives only the active status patch"
);

applyAdapter.commits.length = 0;
assert.deepEqual(await runModerationStatusBackfill({ adapter: applyAdapter, apply: true }), {
  mode: "apply",
  scanned: MAX_BACKFILL_BATCH_SIZE + 5,
  eligible: 0,
  updated: 0,
  batches: 0
}, "rerunning after a successful apply is idempotent");
assert.deepEqual(applyAdapter.commits, []);

await assert.rejects(
  runModerationStatusBackfill({ adapter: applyAdapter, apply: true, batchSize: 401 }),
  /INVALID_BATCH_SIZE/
);

console.log("Moderation status backfill policy passed");
