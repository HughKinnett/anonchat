import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const generator = path.join(repoRoot, "scripts", "generate-vapid-keys.mjs");
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "anonchat-vapid-test-"));
const outputPath = path.join(temporaryRoot, "ephemeral-test-keys.json");
const run = (target) => spawnSync(process.execPath, [generator, target], { cwd: repoRoot, encoding: "utf8" });

try {
  const generated = run(outputPath);
  assert.equal(generated.status, 0, generated.stderr);
  const material = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(Object.keys(material).sort(), ["createdAt", "privateKey", "publicKey"]);
  assert.match(material.publicKey, /^[A-Za-z0-9_-]+$/);
  assert.match(material.privateKey, /^[A-Za-z0-9_-]+$/);
  assert.match(material.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600, "the generated file is owner-only");
  assert.equal(`${generated.stdout}\n${generated.stderr}`.includes(material.privateKey), false, "the private key never reaches stdout or stderr");

  const overwrite = run(outputPath);
  assert.notEqual(overwrite.status, 0, "existing output is never overwritten");
  assert.equal(`${overwrite.stdout}\n${overwrite.stderr}`.includes(material.privateKey), false);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), material);

  const insideRepository = path.join(repoRoot, "ephemeral-vapid-keys.json");
  const rejected = run(insideRepository);
  assert.notEqual(rejected.status, 0, "repository-local output paths are refused");
  await assert.rejects(readFile(insideRepository), { code: "ENOENT" });

  const preexisting = path.join(temporaryRoot, "preexisting.json");
  await writeFile(preexisting, "keep-me", { mode: 0o600 });
  const preexistingResult = run(preexisting);
  assert.notEqual(preexistingResult.status, 0);
  assert.equal(await readFile(preexisting, "utf8"), "keep-me");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

console.log("VAPID generator contract passed");
