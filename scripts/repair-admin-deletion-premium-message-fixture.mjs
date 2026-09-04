import { readFile, writeFile } from "node:fs/promises";

const path = new URL("./test-admin-deletion-firestore-integration.mjs", import.meta.url);
const source = await readFile(path, "utf8");
const before = `      if (descriptor.collection === "reactions") path = \`posts/group-parent/reactions/group-\${entryNumber}\`;\n      if (descriptor.collection === "reports") path = \`moderationCases/group-parent/reports/group-\${entryNumber}\`;`;
const after = `      if (descriptor.collection === "reactions") path = \`posts/group-parent/reactions/group-\${entryNumber}\`;\n      if (descriptor.collection === "messages") path = \`premiumRooms/group-parent/messages/group-\${entryNumber}\`;\n      if (descriptor.collection === "reports") path = \`moderationCases/group-parent/reports/group-\${entryNumber}\`;`;

if (source.includes(after)) {
  console.log("Premium-room message group fixture already present.");
  process.exit(0);
}
if (!source.includes(before)) throw new Error("Premium-room group fixture anchor not found.");
await writeFile(path, source.replace(before, after));
console.log("Added a valid premium-room collection-group message fixture path.");
