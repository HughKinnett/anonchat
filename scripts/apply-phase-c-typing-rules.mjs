import { readFile, writeFile } from "node:fs/promises";

const path = "firestore.rules";
let rules = await readFile(path, "utf8");

const marker = "match /messageRequests/{requestId}/typing/{uid}";
if (!rules.includes(marker)) {
  const anchor = `    match /messageRequests/{requestId}/messages/{messageId} {`;
  if (!rules.includes(anchor)) throw new Error("message request messages rule anchor not found");
  const block = `    match /messageRequests/{requestId}/typing/{uid} {\n      allow read: if activeUser()\n        && acceptedConversation(requestId);\n      allow create, update: if activeUserAfter()\n        && featureEnabled('privateMessagingEnabled')\n        && acceptedConversation(requestId)\n        && uid == request.auth.uid\n        && request.resource.data.keys().hasOnly(['uid', 'expiresAt', 'updatedAt'])\n        && request.resource.data.uid == request.auth.uid\n        && request.resource.data.expiresAt is timestamp\n        && request.resource.data.expiresAt > request.time\n        && request.resource.data.expiresAt <= request.time + duration.value(10, 's')\n        && request.resource.data.updatedAt == request.time;\n      allow delete: if activeUser()\n        && acceptedConversation(requestId)\n        && uid == request.auth.uid;\n    }\n\n`;
  rules = rules.replace(anchor, block + anchor);
  await writeFile(path, rules);
}
