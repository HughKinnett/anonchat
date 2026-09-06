import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const modules = [
  "private-message-typing-integration.js",
  "private-message-reactions-integration.js",
  "private-message-replies-integration.js",
  "private-message-visibility-integration.js"
];

for (const name of modules) {
  const source = await readFile(new URL(`../${name}`, import.meta.url), "utf8");
  assert.match(source, /addEventListener\("pagehide", \(event\) => \{[\s\S]{0,700}event\.persisted/,
    `${name} must handle persisted state inside its pagehide lifecycle`);
  assert.match(source, /addEventListener\("pageshow", \(event\) => \{[\s\S]{0,300}!event\.persisted[\s\S]{0,300}watchConversation\(\)/,
    `${name} must re-establish its active-conversation listener after BFCache resume`);
}

console.log("private message BFCache integration policy passed");
