import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.equal(typeof pkg.scripts?.["test:e2ee"], "string", "package.json must expose a test:e2ee command");
assert.match(pkg.scripts["test:e2ee"], /test-e2ee-crypto\.mjs/);
assert.match(pkg.scripts["test:e2ee"], /test-e2ee-integration-policy\.mjs/);
assert.match(pkg.scripts["test:e2ee"], /test-e2ee-rules/);
assert.match(pkg.scripts["test:firestore-ci"], /test:e2ee/, "full CI must include E2EE verification");
console.log("E2EE package wiring policy passed.");
