import { readFile, writeFile } from "node:fs/promises";

const htmlPath = "community.html";
let html = await readFile(htmlPath, "utf8");
if (!html.includes("private-message-reactions-integration.js")) {
  const anchor = '  <script type="module" src="private-message-typing-integration.js"></script>';
  if (!html.includes(anchor)) throw new Error("typing script anchor not found");
  html = html.replace(anchor, `${anchor}\n  <script type="module" src="private-message-reactions-integration.js"></script>`);
}
if (!html.includes("private-message-replies-integration.js")) {
  const anchor = '  <script type="module" src="private-message-reactions-integration.js"></script>';
  if (!html.includes(anchor)) throw new Error("reaction script anchor not found");
  html = html.replace(anchor, `${anchor}\n  <script type="module" src="private-message-replies-integration.js"></script>`);
}
await writeFile(htmlPath, html);

const communityPath = "community.js";
let community = await readFile(communityPath, "utf8");
if (!community.includes('const replyToMessageId = event.target.dataset.replyToMessageId')) {
  const anchor = '  const text = $("direct-message").value.trim();\n';
  if (!community.includes(anchor)) throw new Error("direct message text anchor not found");
  community = community.replace(anchor, `${anchor}  const replyToMessageId = event.target.dataset.replyToMessageId || "";\n  const replyToSenderId = event.target.dataset.replyToSenderId || "";\n`);
}
if (!community.includes('...(replyToMessageId && replyToSenderId ? { replyToMessageId, replyToSenderId } : {})')) {
  const anchor = '      ...(imageCipher ? { imageCipher } : {}),\n      createdAt: serverTimestamp(),';
  if (!community.includes(anchor)) throw new Error("direct message payload anchor not found");
  community = community.replace(anchor, '      ...(imageCipher ? { imageCipher } : {}),\n      ...(replyToMessageId && replyToSenderId ? { replyToMessageId, replyToSenderId } : {}),\n      createdAt: serverTimestamp(),');
}
if (!community.includes('delete event.target.dataset.replyToMessageId;')) {
  const anchor = '    clearDirectPhoto();\n';
  if (!community.includes(anchor)) throw new Error("direct message success anchor not found");
  community = community.replace(anchor, `${anchor}    delete event.target.dataset.replyToMessageId;\n    delete event.target.dataset.replyToSenderId;\n`);
}
await writeFile(communityPath, community);

const rulesPath = "firestore.rules";
let rules = await readFile(rulesPath, "utf8");
if (!rules.includes("match /messageRequests/{requestId}/messageReactions/{reactionId}")) {
  const anchor = `    match /messageRequests/{requestId}/messages/{messageId} {`;
  if (!rules.includes(anchor)) throw new Error("private messages rule anchor not found");
  const block = `    match /messageRequests/{requestId}/messageReactions/{reactionId} {\n      allow read: if activeUser()\n        && acceptedConversation(requestId);\n      allow create, update: if activeUserAfter()\n        && featureEnabled('privateMessagingEnabled')\n        && acceptedConversation(requestId)\n        && request.resource.data.keys().hasOnly(['messageId', 'uid', 'type', 'updatedAt'])\n        && request.resource.data.messageId is string\n        && request.resource.data.messageId.size() > 0\n        && request.resource.data.uid == request.auth.uid\n        && reactionId == request.resource.data.messageId + '_' + request.auth.uid\n        && request.resource.data.type in ['👍', '❤️', '😂', '😮', '😢', '😡', '🖕']\n        && exists(/databases/$(database)/documents/messageRequests/$(requestId)/messages/$(request.resource.data.messageId))\n        && request.resource.data.updatedAt == request.time;\n      allow delete: if activeUser()\n        && acceptedConversation(requestId)\n        && resource.data.uid == request.auth.uid\n        && reactionId == resource.data.messageId + '_' + request.auth.uid;\n    }\n\n`;
  rules = rules.replace(anchor, block + anchor);
}
if (!rules.includes("'replyToMessageId', 'replyToSenderId'")) {
  const keysAnchor = "          'bodyCipher', 'imageCipher', 'createdAt', 'expiresAt'\n";
  if (!rules.includes(keysAnchor)) throw new Error("private message allowed keys anchor not found");
  rules = rules.replace(keysAnchor, "          'bodyCipher', 'imageCipher', 'replyToMessageId', 'replyToSenderId', 'createdAt', 'expiresAt'\n");

  const validationAnchor = "        && !request.resource.data.keys().hasAny(['text', 'imageData'])\n        && request.resource.data.createdAt == request.time\n";
  if (!rules.includes(validationAnchor)) throw new Error("private message create validation anchor not found");
  const replyValidation = "        && !request.resource.data.keys().hasAny(['text', 'imageData'])\n        && ((!request.resource.data.keys().hasAny(['replyToMessageId', 'replyToSenderId']))\n          || (request.resource.data.keys().hasAll(['replyToMessageId', 'replyToSenderId'])\n            && request.resource.data.replyToMessageId is string\n            && request.resource.data.replyToMessageId.size() > 0\n            && request.resource.data.replyToMessageId.size() <= 128\n            && request.resource.data.replyToSenderId is string\n            && request.resource.data.replyToSenderId.size() > 0\n            && exists(/databases/$(database)/documents/messageRequests/$(requestId)/messages/$(request.resource.data.replyToMessageId))\n            && get(/databases/$(database)/documents/messageRequests/$(requestId)/messages/$(request.resource.data.replyToMessageId)).data.senderId == request.resource.data.replyToSenderId))\n        && request.resource.data.createdAt == request.time\n";
  rules = rules.replace(validationAnchor, replyValidation);
}
await writeFile(rulesPath, rules);
