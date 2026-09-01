import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { shouldRecordDailyPageView } from "../page-view-budget.mjs";

const source = async name => readFile(new URL(`../${name}`, import.meta.url), "utf8");
const [timeline, profile, community, connections, rooms, admin, rules] = await Promise.all([
  "timeline.js", "profile.js", "community.js", "connections.js", "premium-rooms.js", "admin.js", "firestore.rules"
].map(source));

assert.match(timeline, /const TIMELINE_POST_LIMIT = 20/);
assert.match(profile, /const PROFILE_FEED_LIMIT = 30/);
assert.match(community, /otherId !== selectedOther/,
  "only the selected private conversation receives a message listener");
assert.match(community, /messages"\), orderBy\("createdAt", "desc"\), limit\(100\)/);
assert.doesNotMatch(community, /limit\(500\)/);
for (const boundedEdge of [
  'where("followingId", "==", targetUserId), limit(50)',
  'where("followerId", "==", targetUserId), limit(50)',
  'where("followerId", "==", user.uid), limit(100)'
]) assert.ok(connections.includes(boundedEdge), "connection-edge queries always carry a hard limit");
assert.doesNotMatch(rooms, /limit\(500\)|getDocs\(collection\(db,"premiumAccess"\)\)/);
assert.doesNotMatch(admin, /limit\((?:500|1000)\)/);
for (const ceiling of ["imageData', '').size() <= 160000", "profileImage', '').size() <= 160000", "coverImage', '').size() <= 160000"]) assert.ok(rules.includes(ceiling));
assert.match(rules, /affectedKeys\(\)[.]hasAny\(\['profileImage'\]\)[\s\S]*profileImage', ''\)[.]size\(\) <= 160000/,
  "legacy oversized cover data does not block replacing only the profile photo");

const memory = new Map(), storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
const day = new Date("2026-09-01T12:00:00Z");
assert.equal(shouldRecordDailyPageView(storage, day), true);
assert.equal(shouldRecordDailyPageView(storage, day), false);
assert.equal(shouldRecordDailyPageView(storage, new Date("2026-09-02T12:00:00Z")), true);

console.log("Runtime Firebase cost budgets passed.");
