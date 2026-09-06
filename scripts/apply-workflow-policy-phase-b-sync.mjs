import { readFile, writeFile } from "node:fs/promises";

const path = "workflow-policy.mjs";
const source = await readFile(path, "utf8");
const oldSuffix = "&& npm run test:spotify-playlist-privacy && npm test\";";
const newSuffix = "&& npm run test:spotify-playlist-privacy && npm test && npm run test:phase-b && npm run test:phase-b-rules\";";

const matches = source.split(oldSuffix).length - 1;
if (matches !== 1) throw new Error(`Expected exactly one stale Firestore CI policy suffix, found ${matches}`);
if (source.includes(newSuffix)) throw new Error("Workflow policy already includes Phase B gates");

await writeFile(path, source.replace(oldSuffix, newSuffix));
console.log("Synchronized workflow policy with Phase B Firestore CI gates");
