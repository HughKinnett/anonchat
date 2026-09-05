import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/test-admin-deletion-barrier-rules.mjs";
let source = await readFile(path, "utf8");
const needle = `    setDoc(doc(firestore, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) }),`;
const replacement = `${needle}\n    setDoc(doc(firestore, "siteSettings", "features"), { registrationsEnabled: true }),`;
if (!source.includes(needle)) throw new Error("deletion barrier seed marker not found");
source = source.replace(needle, replacement);
await writeFile(path, source);
console.log("enabled registrations in deletion barrier test fixture");
