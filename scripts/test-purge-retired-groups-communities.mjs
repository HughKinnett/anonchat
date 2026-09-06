import assert from "node:assert/strict";
import { purgeRetiredCollections } from "./purge-retired-groups-communities.mjs";

const documents = {
  groups: [{ ref: { path: "groups/g1" } }, { ref: { path: "groups/g2" } }],
  communities: [{ ref: { path: "communities/c1" } }],
  rooms: [{ ref: { path: "rooms/r1" } }],
  users: [{ ref: { path: "users/u1" } }]
};
const requestedCollections = [];
const deleted = [];
const db = {
  collection(name) {
    requestedCollections.push(name);
    return { get: async () => ({ size: documents[name]?.length ?? 0, docs: documents[name] ?? [] }) };
  },
  recursiveDelete: async (ref) => { deleted.push(ref.path); }
};

const result = await purgeRetiredCollections({ db, logger: { log() {} } });
assert.deepEqual(requestedCollections, ["groups", "communities"], "purge queries only retired top-level collections");
assert.deepEqual(deleted, ["groups/g1", "groups/g2", "communities/c1"], "purge recursively deletes only retired roots");
assert.equal(result.deletedRoots, 3);
assert.equal(result.collections.groups, 2);
assert.equal(result.collections.communities, 1);
assert.equal(deleted.some((path) => path.startsWith("rooms/")), false, "Temporary Rooms are never purged");
assert.equal(deleted.some((path) => path.startsWith("users/")), false, "user profiles are never purged");

console.log("Retired Groups/Communities purge scope contract passed");
