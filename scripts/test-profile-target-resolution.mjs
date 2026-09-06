import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolveProfileTarget } from "../profile-target.mjs";

assert.equal(resolveProfileTarget({ search: "?uid=other", currentUserUid: "me" }), "other");
assert.equal(resolveProfileTarget({ search: "", currentUserUid: "me" }), "me");
assert.equal(resolveProfileTarget({ search: "?uid=", currentUserUid: "me" }), "me");
assert.equal(resolveProfileTarget({ search: "", currentUserUid: "" }), null);

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("profile.html", root), "utf8");
const bootstrap = await readFile(new URL("profile-bootstrap.js", root), "utf8");

assert.match(html, /src="profile-bootstrap\.js"/,
  "profile page loads the canonical profile bootstrap");
assert.doesNotMatch(html, /src="profile\.js"/,
  "profile page does not race the main controller before target normalization");
assert.match(bootstrap, /from ["']\.\/profile-target\.mjs["']/,
  "profile bootstrap imports the shared target resolver");
assert.match(bootstrap, /resolveProfileTarget\s*\(/,
  "profile bootstrap resolves visitor or authenticated owner target");
assert.match(bootstrap, /history\.replaceState/,
  "owner profile normalizes the URL before controllers load");
for (const path of ["profile.js", "profile-badges.js", "profile-phase-a.js"]) {
  assert.match(bootstrap, new RegExp(`import\\(["']\\./${path.replace(".", "\\.")}["']\\)`),
    `profile bootstrap loads ${path} after target normalization`);
}

console.log("profile target resolution contract passed");
