import { readFile, writeFile } from "node:fs/promises";

const path = "firestore.rules";
let rules = await readFile(path, "utf8");
const oldText = `    function isProtectedAdministrator(username) {\n      return username is string\n        && username.lower() in ['i_love_you_h', 'cybercapone'];\n    }`;
const newText = `    function isProtectedAdministrator(username) {\n      return username is string\n        && username.lower().matches('^[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*(i_love_you_h|cybercapone)[\\u0009-\\u000d\\u0020\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*$');\n    }`;
if (!rules.includes(oldText)) throw new Error("simplified protected-admin helper not found");
rules = rules.replace(oldText, newText);
await writeFile(path, rules);
console.log("restored whitespace-tolerant protected-admin deletion guard");
