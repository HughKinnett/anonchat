import fs from "node:fs";

const path = "package.json";
const pkg = JSON.parse(fs.readFileSync(path, "utf8"));

pkg.scripts ||= {};
pkg.scripts["test:phase-b"] = [
  "node scripts/test-content-edit-policy.mjs",
  "node scripts/test-threaded-reply-policy.mjs",
  "node scripts/test-post-media-policy.mjs",
  "node scripts/test-saved-history-policy.mjs",
  "node scripts/test-hashtag-discovery-policy.mjs",
  "node scripts/test-suggested-follow-policy.mjs",
  "node scripts/test-recent-search-policy.mjs",
  "node scripts/test-content-writer-policy.mjs",
  "node scripts/test-phase-b-ui.mjs",
  "node scripts/test-phase-b-package.mjs",
  "node scripts/test-phase-b-listener-order.mjs",
  "node scripts/test-phase-b-reference-loading.mjs",
  "node scripts/test-phase-b-discovery-integration.mjs",
  "node scripts/test-phase-b-admin-edit-history.mjs",
  "node scripts/test-phase-b-styles.mjs",
  "node --check timeline.js",
  "node --check profile.js",
  "node --check admin.js"
].join(" && ");

pkg.scripts["test:phase-b-rules"] = "firebase emulators:exec --only firestore \"node scripts/test-phase-b-rules.mjs\"";

const fullGate = String(pkg.scripts["test:firestore-ci"] || "");
if (!fullGate.includes("npm run test:phase-b")) {
  pkg.scripts["test:firestore-ci"] = `${fullGate} && npm run test:phase-b && npm run test:phase-b-rules`;
} else if (!fullGate.includes("npm run test:phase-b-rules")) {
  pkg.scripts["test:firestore-ci"] = `${fullGate} && npm run test:phase-b-rules`;
}

fs.writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
console.log("Applied complete Phase B package/CI integration");
