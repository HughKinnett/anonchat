import { readFile, writeFile } from "node:fs/promises";
const path = "scripts/test-timeline-moderation-ui.mjs";
let source = await readFile(path, "utf8");
const oldText = `assert.doesNotMatch(timeline, /const startInteractionChildren = \\(entry\\) => \\{[\\s\\S]*?orderBy\\("createdAt"/,
  "parent-scoped interaction listeners include legacy records that do not have createdAt");`;
const newText = `const interactionListenerSource = timeline.match(/const startInteractionChildren = \\(entry\\) => \\{([\\s\\S]*?)\\n\\};\\n\\nconst syncInteractionListeners/)?.[1] || "";
assert.doesNotMatch(interactionListenerSource, /orderBy\\("createdAt"/,
  "parent-scoped interaction listeners include legacy records that do not have createdAt");`;
if (!source.includes(oldText)) throw new Error("broad interaction-listener assertion not found");
source = source.replace(oldText, newText);
await writeFile(path, source);
console.log("interaction contract scope fixed");
