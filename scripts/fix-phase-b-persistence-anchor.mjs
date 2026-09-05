import fs from "node:fs";

const path = "scripts/apply-phase-b-persistence.mjs";
let source = fs.readFileSync(path, "utf8");

const repostBefore = `  '    imageData: post.imageData || "",\\n    createdAt: serverTimestamp()',
  '    imageData: post.imageData || "",\\n    media: post.media || [],\\n    createdAt: serverTimestamp()',`;
const repostAfter = `  \`    imageData: post.imageData || "",
    createdAt: serverTimestamp()\`,
  \`    imageData: post.imageData || "",
    media: post.media || [],
    createdAt: serverTimestamp()\`,`;
if (source.includes(repostBefore)) source = source.replace(repostBefore, repostAfter);

const submitBefore = `const submitStart = 'form.addEventListener("submit", async (event) => {';`;
const submitAfter = `const submitStart = 'form.addEventListener("submit", async (event) => {\\n  event.preventDefault();\\n  const postContent = content.value.trim();';`;
if (!source.includes(submitBefore)) throw new Error("Expected broad composer submit anchor was not found");
source = source.replace(submitBefore, submitAfter);

fs.writeFileSync(path, source);
console.log("Repaired Phase B repost and main-composer patch anchors");
