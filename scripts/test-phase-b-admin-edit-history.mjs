import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../admin.js", import.meta.url), "utf8");

assert.match(source, /async function loadContentEditHistory\(entry, host, control\)/, "admin has an edit-history loader");
assert.match(source, /collection\(db, collectionName, entry\.id, "editHistory"\)/, "admin loads canonical post edit history");
assert.match(source, /collection\(db, collectionName, entry\.id, "comments"\)/, "admin inspects comments for edited comment history");
assert.match(source, /collection\(db, collectionName, entry\.id, "comments", comment\.id, "editHistory"\)/, "admin loads canonical comment edit history");
assert.match(source, /View edit history/, "edited content exposes an admin edit-history control");
assert.match(source, /Previous post versions|Previous comment versions/, "admin labels prior versions clearly");

console.log("Phase B admin edit-history contract passed");
