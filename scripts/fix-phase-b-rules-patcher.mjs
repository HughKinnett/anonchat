import fs from "node:fs";

const path = "scripts/apply-phase-b-rules.mjs";
let source = fs.readFileSync(path, "utf8");
const before = "  rules = rules.replace(needle, replacement);";
const after = "  rules = rules.replace(needle, () => replacement);";
if (!source.includes(before) && !source.includes(after)) {
  throw new Error("Could not locate Phase B rules replacement helper");
}
if (source.includes(before)) source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log("Phase B rules patcher now treats replacement text literally");
