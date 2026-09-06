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
  assert.match(source, /addEventListener\("pagehide", \(event\) =>/,
    `${name} must distinguish BFCache pagehide from terminal unload`);
  assert.match(source, /if \(event\.persisted\)/,
    `${name} must preserve or deliberately restore its lifecycle when entering BFCache`);
  assert.match(source, /addEventListener\("pageshow", \(event\) =>/,
    `${name} must restore companion listeners after BFCache resume`);
  assert.match(source, /event\.persisted/,
    `${name} BFCache restore must be gated to persisted pages`);
  assert.match(source, /watchConversation\(\)/,
    `${name} must re-establish its active-conversation Firestore listener after BFCache resume`);
}

console.log("private message BFCache integration policy passed");
