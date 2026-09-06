import { readFile, writeFile } from "node:fs/promises";

const htmlPath = "community.html";
let html = await readFile(htmlPath, "utf8");
if (!html.includes("private-message-reactions-integration.js")) {
  const anchor = '  <script type="module" src="private-message-typing-integration.js"></script>';
  if (!html.includes(anchor)) throw new Error("typing script anchor not found");
  html = html.replace(anchor, `${anchor}\n  <script type="module" src="private-message-reactions-integration.js"></script>`);
  await writeFile(htmlPath, html);
}

const rulesPath = "firestore.rules";
let rules = await readFile(rulesPath, "utf8");
if (!rules.includes("match /messageRequests/{requestId}/messageReactions/{reactionId}")) {
  const anchor = `    match /messageRequests/{requestId}/messages/{messageId} {`;
  if (!rules.includes(anchor)) throw new Error("private messages rule anchor not found");
  const block = `    match /messageRequests/{requestId}/messageReactions/{reactionId} {\n      allow read: if activeUser()\n        && acceptedConversation(requestId);\n      allow create, update: if activeUserAfter()\n        && featureEnabled('privateMessagingEnabled')\n        && acceptedConversation(requestId)\n        && request.resource.data.keys().hasOnly(['messageId', 'uid', 'type', 'updatedAt'])\n        && request.resource.data.messageId is string\n        && request.resource.data.messageId.size() > 0\n        && request.resource.data.uid == request.auth.uid\n        && reactionId == request.resource.data.messageId + '_' + request.auth.uid\n        && request.resource.data.type in ['👍', '❤️', '😂', '😮', '😢', '😡', '🖕']\n        && exists(/databases/$(database)/documents/messageRequests/$(requestId)/messages/$(request.resource.data.messageId))\n        && request.resource.data.updatedAt == request.time;\n      allow delete: if activeUser()\n        && acceptedConversation(requestId)\n        && resource.data.uid == request.auth.uid\n        && reactionId == resource.data.messageId + '_' + request.auth.uid;\n    }\n\n`;
  rules = rules.replace(anchor, block + anchor);
  await writeFile(rulesPath, rules);
}
