import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const scripts = pkg.scripts || {};

assert.equal(typeof scripts["test:phase-b"], "string", "package exposes test:phase-b");
assert.match(scripts["test:phase-b"], /test-content-edit-policy\.mjs/, "Phase B gate includes edit policy");
assert.match(scripts["test:phase-b"], /test-phase-b-ui\.mjs/, "Phase B gate includes UI parity contract");
assert.equal(typeof scripts["test:phase-b-rules"], "string", "package exposes test:phase-b-rules");
assert.match(scripts["test:phase-b-rules"], /test-phase-b-rules\.mjs/, "Phase B rules gate uses emulator contract");
assert.match(scripts["test:firestore-ci"], /test:phase-b/, "full Firestore CI includes Phase B focused tests");
assert.match(scripts["test:firestore-ci"], /test:phase-b-rules/, "full Firestore CI includes Phase B rules tests");

console.log("Phase B package/CI contract passed");
