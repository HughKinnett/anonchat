import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createModerationClient } from "../moderation-client.mjs";

const timestamp = () => "server-time";
const refs = new Map();
const writes = [];
const deletes = [];
const reads = [];
const channels = [];
const channelFactory = () => {
  const channel = { messages: [], postMessage(message) { this.messages.push(message); }, closeCalled: false, close() { this.closeCalled = true; }, onmessage: null };
  channels.push(channel); return channel;
};
const firestore = {
  doc: (_db, ...segments) => ({ path: segments.join("/") }),
  getDoc: async (ref) => { reads.push(ref.path); return { exists: () => refs.has(ref.path), data: () => refs.get(ref.path) }; },
  setDoc: async (ref, payload) => { writes.push({ ref, payload }); refs.set(ref.path, payload); },
  deleteDoc: async (ref) => { deletes.push(ref); refs.delete(ref.path); },
  writeBatch: () => {
    const operations = [];
    return {
      set(ref, payload) { operations.push({ ref, payload }); },
      update(ref, payload) { operations.push({ ref, payload }); },
      async commit() { for (const operation of operations) { writes.push(operation); refs.set(operation.ref.path, { ...(refs.get(operation.ref.path) || {}), ...operation.payload }); } }
    };
  }
};
let now = 100;
const client = createModerationClient({ db: {}, firestore, currentUid: "reporter", timestamp, channelFactory, clock: () => now, negativeCacheMs: 1_000 });
const post = {
  targetKind: "post",
  targetCollection: "posts",
  targetId: "post-1",
  reportedUserId: "author"
};

assert.equal(await client.hasReported(post), false);
assert.equal(await client.hasReported(post), false);
assert.equal(client.cachedReported(post), false);
assert.equal(reads.filter(path => path === "reportReceipts/reporter/post/post-1").length, 1, "duplicate report-state checks share the bounded receipt cache");
const refreshPost = { ...post, targetId: "refresh-post" };
assert.equal(await client.hasReported(refreshPost), false);
refs.set("reportReceipts/reporter/post/refresh-post", { reported: true });
assert.equal(await client.hasReported(refreshPost), false, "negative receipt state is briefly cached");
now += 1_001;
assert.equal(client.cachedReported(refreshPost), undefined, "expired negative receipt state requests bounded refresh");
assert.equal(await client.hasReported(refreshPost), true);
const observed = [];
const passivePost = { ...post, targetId: "passive-post" };
assert.equal(await client.hasReported(passivePost), false);
const stopWatching = client.watchReported(passivePost, (value) => observed.push(value));
channels[0].onmessage({ data: { key: "post:passive-post", reported: true } });
assert.equal(client.cachedReported(passivePost), true, "a passive cross-tab receipt snapshot invalidates a cached false state");
assert.deepEqual(observed, [true]);
stopWatching();

// Once any local or cross-tab source observes true, an older false read can never re-enable reporting controls.
let resolveDeferredRead;
const deferredRead = new Promise((resolve) => { resolveDeferredRead = resolve; });
const raceChannels = [];
const raceClient = createModerationClient({
  db: {},
  firestore: { ...firestore, getDoc: async () => deferredRead },
  currentUid: "race-reporter", timestamp,
  channelFactory: () => {
    const channel = { onmessage: null, postMessage() {}, close() {} };
    raceChannels.push(channel); return channel;
  }
});
const raceTarget = { ...post, targetId: "deferred-race" };
const raceObserved = [];
raceClient.watchReported(raceTarget, (value) => raceObserved.push(value));
const pendingRaceRead = raceClient.hasReported(raceTarget);
raceChannels[0].onmessage({ data: { key: "post:deferred-race", reported: true } });
resolveDeferredRead({ exists: () => false });
assert.equal(await pendingRaceRead, true, "an older false read resolves to the dominant true state");
assert.equal(raceClient.cachedReported(raceTarget), true, "cached true remains monotonic so report controls stay disabled");
assert.deepEqual(raceObserved, [true], "the stale false completion causes no callback render churn");
raceClient.destroy();

// Passive watches must never turn into recurring per-target reads.
let boundedRefreshReads = 0;
const noPollingClient = createModerationClient({
  db: {}, firestore: { ...firestore, getDoc: async () => { boundedRefreshReads += 1; return { exists: () => false }; } },
  currentUid: "no-polling-reporter", timestamp, negativeCacheMs: 1, channelFactory
});
const noPollingTarget = { ...post, targetId: "no-polling" };
const noPollingObserved = [];
const stopNoPollingWatch = noPollingClient.watchReported(noPollingTarget, (value) => noPollingObserved.push(value));
await noPollingClient.hasReported(noPollingTarget);
assert.deepEqual(noPollingObserved, [], "a false confirmation does not cause callback render churn");
await new Promise((resolve) => setTimeout(resolve, 1_150));
assert.equal(boundedRefreshReads, 1, "the strict passive-refresh maximum is the single explicit initial read");
assert.doesNotMatch(await readFile(new URL("../moderation-client.mjs", import.meta.url), "utf8"), /setInterval\(/,
  "report receipt watches never install a recurring polling timer");
stopNoPollingWatch(); noPollingClient.destroy();

await client.report(post, "harassment");
assert.deepEqual(writes, [{
  ref: { path: "reportIntakes/reporter_post_post-1" },
  payload: {
    reporterUid: "reporter",
    targetKind: "post",
    targetCollection: "posts",
    targetId: "post-1",
    targetPath: "posts/post-1",
    reportedUserId: "author",
    reason: "harassment",
    createdAt: "server-time",
    status: "queued"
  }
}, {
  ref: { path: "reportReceipts/reporter/post/post-1" },
  payload: { reporterUid: "reporter", targetKind: "post", targetId: "post-1", createdAt: "server-time" }
}, {
  ref: { path: "posts/post-1" },
  payload: { moderationState: "hidden", moderationHoldId: "reporter_post_post-1", moderationHeldAt: "server-time" }
}, {
  ref: { path: "moderationCases/post_post-1" },
  payload: {
    targetKind: "post",
    targetCollection: "posts",
    targetId: "post-1",
    targetPath: "posts/post-1",
    reportedUserId: "author",
    snapshot: { kind: "post", authorId: "author", authorName: "anonymous", text: "" },
    status: "open",
    reportCount: 1,
    reasonTotals: { harassment: 1 },
    createdAt: "server-time",
    updatedAt: "server-time"
  }
}]);
assert.equal(await client.hasReported(post), true);
assert.equal(client.cachedReported(post), true);
await assert.rejects(() => client.report(post, "harassment"), (error) => error?.code === "already-reported");
assert.equal(writes.length, 4, "a duplicate does not overwrite the atomic report, receipt, hold, or moderation case");
assert.equal([...refs.keys()].filter(path => path === "reportIntakes/reporter_post_post-1").length, 1);
await assert.rejects(() => client.report({ ...post, reportedUserId: "reporter" }, "spam-scam"), /self report/);
await assert.rejects(() => client.report({ ...post, targetKind: "user", targetCollection: "users", targetId: "reporter", reportedUserId: "reporter" }, "other"), /self report/);

assert.equal(await client.isPairBlocked("author"), false);
assert.equal(await client.isPairBlocked("reporter"), false, "a room owner is never treated as self-blocked");
await client.block("author");
assert.deepEqual(writes.at(-1), {
  ref: { path: "blocks/reporter_author" },
  payload: { blockerUid: "reporter", blockedUid: "author", createdAt: "server-time" }
});
assert.equal(await client.isPairBlocked("author"), true);
await client.unblock("author");
assert.deepEqual(deletes, [{ path: "blocks/reporter_author" }]);
await assert.rejects(() => client.block("reporter"), /self block/);
await assert.rejects(() => client.unblock("reporter"), /self block/);

const rejectedWriteClient = createModerationClient({
  db: {},
  firestore: {
    ...firestore,
    setDoc: async () => { throw new Error("write rejected"); }
  },
  currentUid: "reporter",
  timestamp
});
await assert.rejects(
  () => rejectedWriteClient.block("another-user"),
  /write rejected/,
  "write failures stay visible to transactional button handlers"
);

const crossTabClient = createModerationClient({
  db: {},
  firestore: {
    ...firestore,
    writeBatch: () => {
      const operations = [];
      return { set(ref, payload) { operations.push({ ref, payload }); }, update(ref, payload) { operations.push({ ref, payload }); }, async commit() {
        const receipt = operations.find(operation => operation.ref.path.includes("reportReceipts/"));
        refs.set(receipt.ref.path, receipt.payload); throw new Error("duplicate raced");
      } };
    }
  },
  currentUid: "other-reporter",
  timestamp, channelFactory
});
const racedPost = { ...post, targetId: "raced-post" };
await assert.rejects(() => crossTabClient.report(racedPost, "other"), (error) => error?.code === "already-reported");
assert.equal(crossTabClient.cachedReported(racedPost), true, "a concurrent duplicate remains disabled after the rejected write");

// A cross-tab receipt observed during a rejected batch is authoritative even if recovery reads are stale.
let rejectedRaceReads = 0;
let rejectedRaceChannel;
const rejectedRaceClient = createModerationClient({
  db: {},
  firestore: {
    ...firestore,
    getDoc: async () => { rejectedRaceReads += 1; return { exists: () => false }; },
    writeBatch: () => ({
      set() {},
      update() {},
      async commit() {
        rejectedRaceChannel.onmessage({ data: { key: "post:rejected-race", reported: true } });
        throw new Error("batch rejected after cross-tab receipt");
      }
    })
  },
  currentUid: "rejected-race-reporter", timestamp,
  channelFactory: () => (rejectedRaceChannel = { onmessage: null, postMessage() {}, close() {} })
});
const rejectedRacePost = { ...post, targetId: "rejected-race" };
await assert.rejects(() => rejectedRaceClient.report(rejectedRacePost, "other"), (error) => error?.code === "already-reported");
assert.equal(rejectedRaceClient.cachedReported(rejectedRacePost), true,
  "a rejected local batch cannot erase an authoritative cross-tab receipt");
assert.equal(rejectedRaceReads, 2, "recovery path performs the initial receipt read plus the material snapshot read, without a third stale receipt read");
rejectedRaceClient.destroy();

const roomWrites = [];
const roomClient = createModerationClient({
  db: {}, currentUid: "room-reporter", timestamp,
  firestore: {
    ...firestore,
    getDoc: async () => ({ exists: () => false }),
    writeBatch: () => {
      const operations = [];
      return {
        set(ref, payload) { operations.push({ method: "set", path: ref.path, payload }); },
        update(ref, payload) { operations.push({ method: "update", path: ref.path, payload }); },
        async commit() { roomWrites.push(...operations); }
      };
    }
  }
});
await roomClient.report({ targetKind: "room", targetCollection: "rooms", targetId: "room-1", reportedUserId: "owner" }, "other");
assert.deepEqual(roomWrites.find(operation => operation.method === "update" && operation.path === "rooms/room-1"), {
  method: "update",
  path: "rooms/room-1",
  payload: { moderationState: "hidden", moderationHoldId: "room-reporter_room_room-1", moderationHeldAt: "server-time" }
}, "room intake, receipt, and hidden hold share one client batch");
const roomCase = roomWrites.find(operation => operation.method === "set" && operation.path === "moderationCases/room_room-1");
assert.equal(roomCase?.payload?.targetKind, "room");
assert.equal(roomCase?.payload?.status, "open");
assert.equal(roomCase?.payload?.reportedUserId, "owner");
roomClient.destroy();
client.destroy();
assert.equal(channels[0].closeCalled, true, "the one shared cross-tab channel is closed on teardown");

console.log("Moderation client passed");
