import { readFile, writeFile } from "node:fs/promises";

const path = "firestore.rules";
const rules = await readFile(path, "utf8");
const start = rules.indexOf("    function isProtectedAdministrator(username) {");
const end = rules.indexOf("    function hasMatchingAdminReservation(profile) {", start);
if (start < 0 || end < 0) throw new Error("protected-admin helper boundaries not found");
const helper = `    function isProtectedAdministrator(username) {\n      return username is string\n        && username.lower().matches('^[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*(i_love_you_h|cybercapone)[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*$');\n    }\n\n`;
await writeFile(path, rules.slice(0, start) + helper + rules.slice(end));
console.log("repaired protected-admin helper syntax");
