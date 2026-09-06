import assert from "node:assert/strict";
import { purgeRetiredCollections } from "../retired-groups-communities-purge.mjs";

const doc = (path, data = {}) => ({ ref: { path }, data: () => data });
const documents = {
  groups: [doc("groups/g1"), doc("groups/g2")],
  communities: [doc("communities/c1")],
  communityPosts: [
    doc("communityPosts/group-post", { groupId: "g1" }),
    doc("communityPosts/community-post", { communityId: "c1" }),
    doc("communityPosts/unrelated", { category: "Question" })
  ],
  rooms: [doc("rooms/r1")],
  users: [doc("users/u1")]
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
assert.deepEqual(requestedCollections, ["groups", "communities", "communityPosts"],
  "purge reads only retired roots plus the shared post collection needed for marker filtering");
assert.deepEqual(deleted, [
  "groups/g1",
  "groups/g2",
  "communities/c1",
  "communityPosts/group-post",
  "communityPosts/community-post"
], "purge recursively deletes retired roots and only posts marked with group/community IDs");
assert.equal(result.deletedRoots, 3);
assert.equal(result.retiredCommunityPosts, 2);
assert.equal(result.collections.groups, 2);
assert.equal(result.collections.communities, 1);
assert.equal(deleted.includes("communityPosts/unrelated"), false, "unrelated shared community posts remain untouched");
assert.equal(deleted.some((path) => path.startsWith("rooms/")), false, "Temporary Rooms are never purged");
assert.equal(deleted.some((path) => path.startsWith("users/")), false, "user profiles are never purged");

console.log("Retired Groups/Communities purge scope contract passed");
