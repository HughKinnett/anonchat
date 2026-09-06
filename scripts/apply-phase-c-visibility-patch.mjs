import { readFile, writeFile } from "node:fs/promises";

const htmlPath = "community.html";
let html = await readFile(htmlPath, "utf8");
if (!html.includes("private-message-visibility-integration.js")) {
  const anchor = '  <script type="module" src="private-message-replies-integration.js"></script>';
  if (!html.includes(anchor)) throw new Error("reply integration script anchor not found");
  html = html.replace(anchor, `${anchor}\n  <script type="module" src="private-message-visibility-integration.js"></script>`);
  await writeFile(htmlPath, html);
}

const communityPath = "community.js";
let community = await readFile(communityPath, "utf8");
community = community.replace(
  '  messages.forEach(message => message.data().encrypted ? void decryptDirectMessage(message, other) : void migrateDirectMessage(message, other));',
  '  messages.forEach(message => { if (!message.data().unsentAt) message.data().encrypted ? void decryptDirectMessage(message, other) : void migrateDirectMessage(message, other); });'
);
if (!community.includes('text.textContent = data.unsentAt ? "Message unsent"')) {
  community = community.replace(
    /^    text\.textContent = .*$/m,
    '    text.textContent = data.unsentAt ? "Message unsent" : (decrypted?.error || decrypted?.text || (data.encrypted ? "Unlocking encrypted message…" : ""));'
  );
}
const hardDelete = `    const remove = document.createElement("button");\n    remove.type = "button";\n    remove.className = "private-message-delete";\n    remove.textContent = "Delete for everyone";\n    remove.addEventListener("click", async () => {\n      remove.disabled = true;\n      try {\n        await deleteDoc(message.ref);\n        revealedPrivatePhotos.delete(message.id);\n        setStatus("Private message deleted permanently.");\n      } catch {\n        remove.disabled = false;\n        setStatus("Could not delete that private message.", true);\n      }\n    });\n    actions.append(remove);\n`;
community = community.replace(hardDelete, "");
if (!community.includes('if (data.unsentAt || data.text || data.bodyCipher) item.append(text);')) {
  community = community.replace(
    /^    if \(data\.text \|\| data\.bodyCipher\) item\.append\(text\);$/m,
    '    if (data.unsentAt || data.text || data.bodyCipher) item.append(text);'
  );
}
community = community.replace(
  '    const imageData = data.senderId === state.user.uid ? (decrypted?.imageData || data.imageData) : revealedImage;',
  '    const imageData = data.unsentAt ? "" : (data.senderId === state.user.uid ? (decrypted?.imageData || data.imageData) : revealedImage);'
);
community = community.replace(
  '    } else if ((data.imageData || data.imageCipher) && data.senderId !== state.user.uid) {',
  '    } else if (!data.unsentAt && (data.imageData || data.imageCipher) && data.senderId !== state.user.uid) {'
);
community = community.replace(
  '    } else if (data.photoViewedAt) {',
  '    } else if (!data.unsentAt && data.photoViewedAt) {'
);
const deleteChatStart = '$("delete-chat").addEventListener("click", async () => {';
const deleteChatEnd = '\n\n$("direct-message-form").addEventListener("submit", async (event) => {';
const startIndex = community.indexOf(deleteChatStart);
const endIndex = community.indexOf(deleteChatEnd, startIndex);
if (startIndex >= 0 && endIndex > startIndex) {
  community = community.slice(0, startIndex) + community.slice(endIndex + 2);
}
await writeFile(communityPath, community);

const rulesPath = "firestore.rules";
let rules = await readFile(rulesPath, "utf8");
if (!rules.includes("match /messageRequests/{requestId}/messageVisibility/{visibilityId}")) {
  const anchor = '    match /messageRequests/{requestId}/messages/{messageId} {';
  if (!rules.includes(anchor)) throw new Error("private message rules anchor not found");
  const block = `    match /messageRequests/{requestId}/messageVisibility/{visibilityId} {\n      allow read: if activeUser()\n        && acceptedConversation(requestId)\n        && resource.data.uid == request.auth.uid;\n      allow create, update: if activeUserAfter()\n        && acceptedConversation(requestId)\n        && request.resource.data.keys().hasOnly(['messageId', 'uid', 'hiddenAt'])\n        && request.resource.data.messageId is string\n        && request.resource.data.messageId.size() > 0\n        && request.resource.data.uid == request.auth.uid\n        && visibilityId == request.resource.data.messageId + '_' + request.auth.uid\n        && exists(/databases/$(database)/documents/messageRequests/$(requestId)/messages/$(request.resource.data.messageId))\n        && request.resource.data.hiddenAt == request.time;\n      allow delete: if activeUser()\n        && acceptedConversation(requestId)\n        && resource.data.uid == request.auth.uid;\n    }\n\n`;
  rules = rules.replace(anchor, block + anchor);
}
if (!rules.includes("request.resource.data.unsentAt == request.time")) {
  const migrationTail = `          (resource.data.get('encrypted', false) != true\n            && request.resource.data.encrypted == true\n            && request.resource.data.cipherVersion == 1\n            && validEncryptedEnvelope(request.resource.data.bodyCipher, 2048)\n            && (!request.resource.data.keys().hasAny(['imageCipher'])\n              || validEncryptedEnvelope(request.resource.data.imageCipher, 230000))\n            && !request.resource.data.keys().hasAny(['text', 'imageData'])\n            && request.resource.data.diff(resource.data).affectedKeys()\n              .hasOnly(['text', 'imageData', 'encrypted', 'cipherVersion', 'bodyCipher', 'imageCipher']))\n        );\n      allow delete: if signedIn()\n        && request.auth.uid in resource.data.participants;`;
  const replacement = `          (resource.data.get('encrypted', false) != true\n            && request.resource.data.encrypted == true\n            && request.resource.data.cipherVersion == 1\n            && validEncryptedEnvelope(request.resource.data.bodyCipher, 2048)\n            && (!request.resource.data.keys().hasAny(['imageCipher'])\n              || validEncryptedEnvelope(request.resource.data.imageCipher, 230000))\n            && !request.resource.data.keys().hasAny(['text', 'imageData'])\n            && request.resource.data.diff(resource.data).affectedKeys()\n              .hasOnly(['text', 'imageData', 'encrypted', 'cipherVersion', 'bodyCipher', 'imageCipher']))\n          ||\n          (resource.data.senderId == request.auth.uid\n            && !resource.data.keys().hasAny(['unsentAt', 'unsentBy'])\n            && request.resource.data.unsentAt == request.time\n            && request.resource.data.unsentBy == request.auth.uid\n            && !request.resource.data.keys().hasAny(['bodyCipher', 'imageCipher', 'text', 'imageData'])\n            && request.resource.data.diff(resource.data).affectedKeys()\n              .hasOnly(['bodyCipher', 'imageCipher', 'text', 'imageData', 'unsentAt', 'unsentBy']))\n        );\n      allow delete: if false;`;
  if (!rules.includes(migrationTail)) throw new Error("private message update/delete rule tail not found");
  rules = rules.replace(migrationTail, replacement);
}
await writeFile(rulesPath, rules);
