import assert from "node:assert/strict";
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const scripts = pkg.scripts || {};

assert.equal(typeof scripts["test:phase-b"], "string", "package exposes test:phase-b");
for (const required of [
  "test-content-edit-policy.mjs",
  "test-threaded-reply-policy.mjs",
  "test-post-media-policy.mjs",
  "test-saved-history-policy.mjs",
  "test-hashtag-discovery-policy.mjs",
  "test-suggested-follow-policy.mjs",
  "test-recent-search-policy.mjs",
  "test-content-writer-policy.mjs",
  "test-phase-b-ui.mjs",
  "test-phase-b-listener-order.mjs",
  "test-phase-b-reference-loading.mjs",
  "test-phase-b-discovery-integration.mjs",
  "test-phase-b-admin-edit-history.mjs",
  "test-phase-b-styles.mjs"
]) {
  assert.ok(scripts["test:phase-b"].includes(required), `Phase B gate includes ${required}`);
}
assert.match(scripts["test:phase-b"], /node --check timeline\.js/, "Phase B gate syntax-checks timeline.js");
assert.match(scripts["test:phase-b"], /node --check profile\.js/, "Phase B gate syntax-checks profile.js");
assert.match(scripts["test:phase-b"], /node --check admin\.js/, "Phase B gate syntax-checks admin.js");
assert.equal(typeof scripts["test:phase-b-rules"], "string", "package exposes test:phase-b-rules");
assert.match(scripts["test:phase-b-rules"], /test-phase-b-rules\.mjs/, "Phase B rules gate uses emulator contract");
assert.match(scripts["test:firestore-ci"], /test:phase-b/, "full Firestore CI includes Phase B focused tests");
assert.match(scripts["test:firestore-ci"], /test:phase-b-rules/, "full Firestore CI includes Phase B rules tests");

console.log("Phase B package/CI contract passed");
