import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../delete-account.js", import.meta.url), "utf8");

assert.doesNotMatch(
  source,
  /if\s*\(!user\)\s*\{[^}]*location\.replace\("index\.html"\)/s,
  "signed-out visitors must stay on the public delete-account page"
);
assert.match(
  source,
  /signInWithEmailAndPassword/,
  "the delete-account page must be able to authenticate a signed-out user"
);
assert.match(
  source,
  /currentUser\s*=\s*credential\.user/,
  "deletion must continue with the authenticated account"
);
assert.match(
  source,
  /const loadDeletionProfile=async\(user\)=>\{[\s\S]*getDoc\(doc\(db,"users",user\.uid\)\)/,
  "the authenticated account profile must be loaded before deletion"
);
assert.match(
  source,
  /await loadDeletionProfile\(currentUser\)/,
  "signed-out deletion must load the authenticated profile before continuing"
);

console.log("public delete-account flow regression passed");
