import { readFile, writeFile } from "node:fs/promises";
import { hardenRetiredFeatureRules } from "./retired-feature-rules-hardening.mjs";

const rulesUrl = new URL("../firestore.rules", import.meta.url);
const before = await readFile(rulesUrl, "utf8");
const after = hardenRetiredFeatureRules(before);
if (after === before) throw new Error("Firestore rules hardening made no changes.");
await writeFile(rulesUrl, after);
console.log("Retired Groups/Communities paths denied and badge writes locked to server-only processing.");
