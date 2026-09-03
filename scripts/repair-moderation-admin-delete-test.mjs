import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./test-moderation-rules.mjs", import.meta.url);
const source = await readFile(path, "utf8");
const before = '  await assertFails(deleteDoc(doc(admin, "posts", "post-2")));';
const after = '  await assertSucceeds(deleteDoc(doc(admin, "posts", "post-2")), "authorized admins retain direct post deletion controls");';

if (!source.includes(before)) {
  throw new Error("Expected stale admin-delete assertion was not found.");
}

const updated = source.replace(before, after);
if (updated === source) throw new Error("No moderation rule test change was made.");
await writeFile(path, updated);
console.log("Updated stale admin post-deletion regression expectation.");
