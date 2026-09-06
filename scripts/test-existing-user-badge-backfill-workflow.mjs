import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, verifier] = await Promise.all([
  readFile(new URL("../.github/workflows/backfill-existing-user-badges.yml", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("./verify-founder-founding-badges.mjs", import.meta.url), "utf8").catch(() => "")
]);

assert.match(workflow, /name:\s*Backfill existing user badges/i);
assert.match(workflow, /workflow_run:/, "backfill is chained to a completed production workflow");
assert.match(workflow, /workflows:\s*\[?\s*["']Deploy Firebase["']/, "backfill watches the production Firebase deployment");
assert.match(workflow, /workflow_dispatch:/, "backfill can be deliberately rerun because it is idempotent");
assert.match(workflow, /workflow_run\.conclusion\s*==\s*["']success["']/, "automatic backfill only runs after a successful Firebase deploy");
assert.match(workflow, /google-github-actions\/auth@v3/, "backfill authenticates with Google using the existing deployment pattern");
assert.match(workflow, /FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN/, "backfill uses the existing Firebase service-account secret");
assert.match(workflow, /node scripts\/badge-full-backfill\.mjs/, "backfill executes the trusted full-user badge CLI");
assert.match(workflow, /node scripts\/verify-founder-founding-badges\.mjs/, "backfill verifies founder/founding Premium state");
assert.match(workflow, /GCLOUD_PROJECT:\s*anonchatlogin/, "backfill targets the AnonChat Firebase project");
assert.match(workflow, /GOOGLE_APPLICATION_CREDENTIALS:/, "backfill passes authenticated credentials to Firebase Admin");

assert.match(verifier, /isAnonChatFounder\(/, "verifier uses the trusted founder identity source");
assert.match(verifier, /FOUNDING_MEMBER_CUTOFF/, "verifier uses the same founding-member cutoff as awarding");
assert.match(verifier, /const foundingMember = !founder &&/, "verifier excludes founders from Founding Member eligibility");
for (const badgeId of ["founder", "founding-member", "premium-member"]) {
  assert.match(verifier, new RegExp(`collection\\(["']badges["']\\)\\.doc\\(["']${badgeId}["']\\)`),
    `verifier checks ${badgeId}`);
}
for (const counter of [
  "foundersMissingFounder",
  "foundersWithFoundingMember",
  "foundersMissingPremium",
  "foundingMembersMissingFounding",
  "foundingMembersMissingPremium"
]) {
  assert.match(verifier, new RegExp(counter), `verifier reports ${counter}`);
}
assert.match(verifier, /process\.exitCode\s*=\s*1/, "verifier fails rollout on overlap or missing entitlement");

console.log("Existing-user founder/founding Premium backfill contract passed.");
