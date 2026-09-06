import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(new URL("../.github/workflows/purge-retired-groups-communities.yml", import.meta.url), "utf8");
assert.match(workflow, /workflow_run:/, "retired data purge is chained to a completed workflow rather than racing deployment");
assert.match(workflow, /Deploy Firebase/, "retired data purge waits for the production Firebase workflow");
assert.match(workflow, /types:\s*\[completed\]/, "purge runs only after deployment completes");
assert.match(workflow, /conclusion\s*==\s*['"]success['"]|conclusion\s*==\s*success/, "purge job requires a successful deployment conclusion");
assert.match(workflow, /head_branch\s*==\s*['"]main['"]|head_branch\s*==\s*main/, "purge is restricted to the production main branch deployment");
assert.match(workflow, /google-github-actions\/auth@v3/, "purge authenticates through the trusted Google action");
assert.match(workflow, /FIREBASE_SERVICE_ACCOUNT_ANONCHATLOGIN/, "purge uses the existing production service-account secret");
assert.match(workflow, /purge-retired-groups-communities\.mjs/, "purge workflow invokes the narrowly scoped cleanup script");
assert.doesNotMatch(workflow, /firebase deploy/, "purge workflow cannot deploy or alter unrelated Firebase surfaces");

console.log("Retired data purge workflow contract passed");
