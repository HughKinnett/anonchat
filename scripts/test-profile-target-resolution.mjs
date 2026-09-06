import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveProfileTarget } from "../profile-target.mjs";

assert.equal(resolveProfileTarget({ search: "?uid=other", currentUserUid: "me" }), "other");
assert.equal(resolveProfileTarget({ search: "", currentUserUid: "me" }), "me");
assert.equal(resolveProfileTarget({ search: "?uid=", currentUserUid: "me" }), "me");
assert.equal(resolveProfileTarget({ search: "", currentUserUid: "" }), null);

const root = new URL("../", import.meta.url);
for (const path of ["profile.js", "profile-badges.js", "profile-phase-a.js"]) {
  const source = await readFile(new URL(path, root), "utf8");
  assert.match(source, /from ["']\.\/profile-target\.mjs["']/,
    `${path} imports the shared profile target resolver`);
  assert.match(source, /resolveProfileTarget\s*\(/,
    `${path} uses the shared profile target resolver`);
}

console.log("profile target resolution contract passed");
