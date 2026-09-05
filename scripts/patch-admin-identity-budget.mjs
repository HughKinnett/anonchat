import { readFile, writeFile } from "node:fs/promises";

const path = "firestore.rules";
let rules = await readFile(path, "utf8");

const start = rules.indexOf("    function isProtectedAdministrator(username) {");
const end = rules.indexOf("    function hasNoDeletionQueueState(profile) {", start);
if (start < 0 || end < 0) throw new Error("admin identity helper block not found");

const replacement = `    function isProtectedAdministrator(username) {\n      return username is string\n        && username.lower() in ['i_love_you_h', 'cybercapone'];\n    }\n\n    function hasMatchingAdminReservation(profile) {\n      let normalizedUsername = profile.username.lower();\n      let reservationPath = /databases/$(database)/documents/usernames/$(normalizedUsername);\n      return profile.username is string\n        && normalizedUsername in ['i_love_you_h', 'cybercapone']\n        && exists(reservationPath)\n        && get(reservationPath).data.uid == request.auth.uid\n        && get(reservationPath).data.username == profile.username;\n    }\n\n`;

rules = rules.slice(0, start) + replacement + rules.slice(end);
await writeFile(path, rules);
console.log("simplified protected-admin identity checks");
