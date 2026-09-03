import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const scriptsDir = new URL("./", import.meta.url);
const files = (await readdir(scriptsDir, { withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name.startsWith("test-") && entry.name.endsWith(".mjs"))
  .map(entry => entry.name)
  .sort();

const bareAuthenticatedContext = /(\b[A-Za-z_$][\w$]*\.authenticatedContext)\(([^,\n()]+)\)/g;
const changed = [];
let replacements = 0;

for (const name of files) {
  const path = join(scriptsDir.pathname, name);
  const source = await readFile(path, "utf8");
  let fileReplacements = 0;
  const updated = source.replace(bareAuthenticatedContext, (match, callee, arg) => {
    fileReplacements += 1;
    return `${callee}(${arg}, { email_verified: true })`;
  });

  if (fileReplacements > 0) {
    await writeFile(path, updated);
    changed.push(`${name}: ${fileReplacements}`);
    replacements += fileReplacements;
  }
}

if (replacements === 0) {
  throw new Error("No bare authenticatedContext test fixtures were found to migrate.");
}

console.log(`Updated ${replacements} authenticated test context(s):`);
for (const item of changed) console.log(`- ${item}`);
