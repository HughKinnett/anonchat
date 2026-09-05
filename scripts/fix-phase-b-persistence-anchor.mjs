import fs from "node:fs";

const path = "scripts/apply-phase-b-persistence.mjs";
let source = fs.readFileSync(path, "utf8");
const before = `  '    imageData: post.imageData || "",\\n    createdAt: serverTimestamp()',
  '    imageData: post.imageData || "",\\n    media: post.media || [],\\n    createdAt: serverTimestamp()',`;
const after = `  \`    imageData: post.imageData || "",
    createdAt: serverTimestamp()\`,
  \`    imageData: post.imageData || "",
    media: post.media || [],
    createdAt: serverTimestamp()\`,`;

if (!source.includes(before)) throw new Error("Expected broken repost anchor was not found");
source = source.replace(before, after);
fs.writeFileSync(path, source);
console.log("Repaired Phase B repost media patch anchor");
