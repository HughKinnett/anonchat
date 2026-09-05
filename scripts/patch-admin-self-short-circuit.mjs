import { readFile, writeFile } from "node:fs/promises";

const path = "firestore.rules";
const before = await readFile(path, "utf8");
const oldText = `    function validStandaloneAdminAccountControl(userId) {\n      let changed = request.resource.data.diff(resource.data).affectedKeys();\n      return isAdmin()`;
const newText = `    function validStandaloneAdminAccountControl(userId) {\n      let changed = request.resource.data.diff(resource.data).affectedKeys();\n      return request.auth.uid != userId\n        && isAdmin()`;
if (!before.includes(oldText)) throw new Error("admin account-control function prefix not found");
const after = before.replace(oldText, newText);
if (after === before) throw new Error("short-circuit patch made no changes");
await writeFile(path, after);
console.log("admin self-update short-circuit applied");
