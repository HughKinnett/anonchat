import { readFile, writeFile } from "node:fs/promises";

const path = "firestore.rules";
const rules = await readFile(path, "utf8");
const corruption = "\n  }\n}\n);\n    }\n\n    function hasMatchingAdminReservation(profile) {";
const at = rules.indexOf(corruption);
if (at < 0) throw new Error("duplicated rules tail marker not found");
const clean = rules.slice(0, at) + "\n  }\n}\n";
await writeFile(path, clean);
console.log("removed duplicated Firestore rules tail");
