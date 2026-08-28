import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

assert.equal(typeof vm.SourceTextModule, "function", "run this test with --experimental-vm-modules");

const context = vm.createContext({ Promise });
const lookups = [];
const follows = [];
const reservations = new Map([
  ["usernames/i_love_you_h", { uid: "admin-one" }],
  ["usernames/cybercapone", { uid: "admin-two" }],
  ["usernames/ownercybercapone", { uid: "former-handle-user" }]
]);
const doc = (_db, ...segments) => segments.join("/");
const getDoc = async (reference) => {
  lookups.push(reference);
  return {
    exists: () => reservations.has(reference),
    data: () => reservations.get(reference)
  };
};
const setDoc = async (reference, data) => { follows.push({ reference, data }); };
const serverTimestamp = () => "server-time";
const firebaseModule = new vm.SyntheticModule(
  ["doc", "getDoc", "serverTimestamp", "setDoc"],
  function setFirebaseExports() {
    this.setExport("doc", doc);
    this.setExport("getDoc", getDoc);
    this.setExport("serverTimestamp", serverTimestamp);
    this.setExport("setDoc", setDoc);
  },
  { context }
);
const policyModule = new vm.SourceTextModule(
  await readFile(new URL("../admin-deletion-policy.mjs", import.meta.url), "utf8"),
  { context, identifier: "admin-deletion-policy.mjs" }
);
const defaultFollowsModule = new vm.SourceTextModule(
  await readFile(new URL("../default-follows.js", import.meta.url), "utf8"),
  { context, identifier: "default-follows.js" }
);
await defaultFollowsModule.link(async (specifier) => {
  if (specifier.startsWith("https://www.gstatic.com/firebasejs/")) return firebaseModule;
  if (specifier === "./admin-deletion-policy.mjs") return policyModule;
  throw new Error(`Unexpected import: ${specifier}`);
});
await defaultFollowsModule.evaluate();

assert.equal(
  await defaultFollowsModule.namespace.ensureDefaultOwnerFollows("member", { name: "db" }),
  true
);
assert.deepEqual(lookups.sort(), ["usernames/cybercapone", "usernames/i_love_you_h"],
  "new accounts resolve only the two intended administrator reservations");
assert.deepEqual(
  follows.map(({ reference }) => reference).sort(),
  ["follows/member_admin-one", "follows/member_admin-two"],
  "default follows never grant prominence to the former unclaimed handle"
);
assert.deepEqual(follows.map(({ data }) => data.createdAt), ["server-time", "server-time"]);

console.log("Default administrator follows passed");
