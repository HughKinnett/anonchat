import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/test-activity-rules.mjs";
let source = await readFile(path, "utf8");
const needle = `    setDoc(doc(firestore, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) })`;
const replacement = `    setDoc(doc(firestore, "system", "accountStats"), { count: 5, limit: 500, updatedAt: new Date(0) }),\n    setDoc(doc(firestore, "siteSettings", "features"), { registrationsEnabled: true })`;
if (!source.includes(needle)) throw new Error("activity seed marker not found");
source = source.replace(needle, replacement);
await writeFile(path, source);
console.log("enabled registrations in activity test fixture");
