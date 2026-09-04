import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../firestore.rules", import.meta.url);
const source = await readFile(path, "utf8");
const before = `        && (conversation.data.fromId == request.auth.uid\n          || conversation.data.toId == request.auth.uid)\n        && !pairIsBlocked(conversation.data.fromId, conversation.data.toId)\n        && message.participants is list`;
const after = `        && (conversation.data.fromId == request.auth.uid\n          || conversation.data.toId == request.auth.uid)\n        && accountAvailableAfter(conversation.data.fromId)\n        && accountAvailableAfter(conversation.data.toId)\n        && !pairIsBlocked(conversation.data.fromId, conversation.data.toId)\n        && message.participants is list`;

if (source.includes(after)) {
  console.log("Direct-message deletion barrier already present.");
  process.exit(0);
}
if (!source.includes(before)) throw new Error("Direct-message deletion barrier anchor not found.");
const updated = source.replace(before, after);
await writeFile(path, updated);
console.log("Added deletion barriers for both encrypted direct-message participants.");
