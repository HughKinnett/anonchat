import { readFile, writeFile } from "node:fs/promises";

const htmlPath = "community.html";
let html = await readFile(htmlPath, "utf8");
if (!html.includes('id="message-request-privacy"')) {
  const anchor = '          <label>Muted keywords<input id="muted-keywords" maxlength="200" placeholder="Separate words with commas"></label>';
  if (!html.includes(anchor)) throw new Error("privacy form anchor not found");
  html = html.replace(anchor, `${anchor}\n          <label>Who can send me new message requests<select id="message-request-privacy"><option value="everyone">Everyone</option><option value="people-i-follow">People I follow</option><option value="none">No new requests</option></select></label>`);
  await writeFile(htmlPath, html);
}

const communityPath = "community.js";
let community = await readFile(communityPath, "utf8");
if (!community.includes('import { canCreateMessageRequest } from "./private-message-request-policy.mjs";')) {
  const anchor = 'import { messageRequestButtonAction, messageRequestButtonState } from "./message-request-policy.mjs";';
  if (!community.includes(anchor)) throw new Error("message request import anchor not found");
  community = community.replace(anchor, `${anchor}\nimport { canCreateMessageRequest } from "./private-message-request-policy.mjs";`);
}
if (!community.includes('requestPrivacyMode: "everyone"')) {
  community = community.replace(
    '  messages: [], reveals: [], preferences: null, activeRoom: "",',
    '  messages: [], reveals: [], preferences: null, requestPrivacyMode: "everyone", activeRoom: "",'
  );
}
if (!community.includes('privacySnapshot = await getDoc(doc(db, "messageRequestPrivacy", to))')) {
  const oldBlock = `  const [outgoingFollow, incomingFollow] = await Promise.all([\n    getDoc(doc(db, "follows", \`\${state.user.uid}_\${to}\`)),\n    getDoc(doc(db, "follows", \`\${to}_\${state.user.uid}\`))\n  ]);\n  const mutual = outgoingFollow.exists() && incomingFollow.exists();`;
  const newBlock = `  const [outgoingFollow, incomingFollow] = await Promise.all([\n    getDoc(doc(db, "follows", \`\${state.user.uid}_\${to}\`)),\n    getDoc(doc(db, "follows", \`\${to}_\${state.user.uid}\`))\n  ]);\n  const privacySnapshot = await getDoc(doc(db, "messageRequestPrivacy", to));\n  const requestMode = privacySnapshot.exists() ? privacySnapshot.data().mode : "everyone";\n  const mutual = outgoingFollow.exists() && incomingFollow.exists();\n  if (!canCreateMessageRequest({\n    mode: requestMode,\n    followsRecipient: incomingFollow.exists(),\n    blocked: isBlockedUid(to),\n    alreadyAccepted: false\n  })) {\n    throw Object.assign(new Error("This user is not accepting a new message request from you."), { code: "request-privacy" });\n  }`;
  if (!community.includes(oldBlock)) throw new Error("createMessageRequest follow block not found");
  community = community.replace(oldBlock, newBlock);
}
if (!community.includes('error?.code === "request-privacy"')) {
  community = community.replace(
    '    console.error("Message request failed", error);\n    setRequestStatus("Could not send request. Please try again.", true);',
    '    console.error("Message request failed", error);\n    setRequestStatus(error?.code === "request-privacy" ? "This user is not accepting a new message request from you." : "Could not send request. Please try again.", true);'
  );
}
if (!community.includes('doc(db, "messageRequestPrivacy", state.user.uid)')) {
  const anchor = `    await setDoc(doc(db, "userPrivate", state.user.uid), {\n      uid: state.user.uid, interests: $("privacy-interests").value.trim(), region: $("privacy-region").value.trim(),\n      ageRange: $("privacy-age").value, updatedAt: serverTimestamp()\n    }, { merge: true });`;
  if (!community.includes(anchor)) throw new Error("privacy save anchor not found");
  community = community.replace(anchor, `${anchor}\n    await setDoc(doc(db, "messageRequestPrivacy", state.user.uid), {\n      uid: state.user.uid, mode: $("message-request-privacy").value, updatedAt: serverTimestamp()\n    }, { merge: true });\n    state.requestPrivacyMode = $("message-request-privacy").value;`);
}
if (!community.includes('$("message-request-privacy").value = state.requestPrivacyMode || "everyone";')) {
  const anchor = '  $("privacy-age").value = state.privateDetails.ageRange || "";';
  if (!community.includes(anchor)) throw new Error("load privacy anchor not found");
  community = community.replace(anchor, `${anchor}\n  $("message-request-privacy").value = state.requestPrivacyMode || "everyone";`);
}
community = community.replace(
  '    messages: [], reveals: [], preferences: null, activeRoom: "", moderation: null, e2eeIdentity: null',
  '    messages: [], reveals: [], preferences: null, requestPrivacyMode: "everyone", activeRoom: "", moderation: null, e2eeIdentity: null'
);
if (!community.includes('const requestPrivacySnapshot = await getDoc(doc(db, "messageRequestPrivacy", user.uid));')) {
  const anchor = `  state.privateDetails = privateSnapshot.exists() ? privateSnapshot.data() : {};\n  loadPrivacy();`;
  if (!community.includes(anchor)) throw new Error("auth private details anchor not found");
  community = community.replace(anchor, `  state.privateDetails = privateSnapshot.exists() ? privateSnapshot.data() : {};\n  const requestPrivacySnapshot = await getDoc(doc(db, "messageRequestPrivacy", user.uid));\n  if (!sessionIsCurrent()) return;\n  state.requestPrivacyMode = requestPrivacySnapshot.exists() ? requestPrivacySnapshot.data().mode : "everyone";\n  loadPrivacy();`);
}
await writeFile(communityPath, community);

const rulesPath = "firestore.rules";
let rules = await readFile(rulesPath, "utf8");
if (!rules.includes("function recipientAllowsMessageRequest(recipientUid, senderUid)")) {
  const anchor = `    function mutuallyFollowAfter(left, right) {\n      return existsAfter(/databases/$(database)/documents/follows/$(left + '_' + right))\n        && existsAfter(/databases/$(database)/documents/follows/$(right + '_' + left));\n    }`;
  if (!rules.includes(anchor)) throw new Error("mutual follow helper anchor not found");
  const helper = `${anchor}\n\n    function recipientAllowsMessageRequest(recipientUid, senderUid) {\n      let privacyPath = /databases/$(database)/documents/messageRequestPrivacy/$(recipientUid);\n      return !exists(privacyPath)\n        || get(privacyPath).data.get('mode', 'everyone') == 'everyone'\n        || (get(privacyPath).data.get('mode', 'everyone') == 'people-i-follow'\n          && exists(/databases/$(database)/documents/follows/$(recipientUid + '_' + senderUid)));\n    }`;
  rules = rules.replace(anchor, helper);
}
if (!rules.includes('match /messageRequestPrivacy/{uid}')) {
  const anchor = '    match /messageRequests/{requestId} {';
  if (!rules.includes(anchor)) throw new Error("message requests rule anchor not found");
  const block = `    match /messageRequestPrivacy/{uid} {\n      allow read: if signedIn() && accountAvailable(uid);\n      allow create, update: if activeUserAfter()\n        && uid == request.auth.uid\n        && request.resource.data.keys().hasOnly(['uid', 'mode', 'updatedAt'])\n        && request.resource.data.uid == request.auth.uid\n        && request.resource.data.mode in ['everyone', 'people-i-follow', 'none']\n        && request.resource.data.updatedAt == request.time;\n      allow delete: if activeUser() && uid == request.auth.uid;\n    }\n\n`;
  rules = rules.replace(anchor, block + anchor);
}
if (!rules.includes('recipientAllowsMessageRequest(request.resource.data.toId, request.resource.data.fromId)')) {
  const anchor = `        && !pairIsBlocked(request.auth.uid, request.resource.data.toId)\n        && (request.resource.data.status == 'pending'`;
  if (!rules.includes(anchor)) throw new Error("message request create policy anchor not found");
  rules = rules.replace(anchor, `        && !pairIsBlocked(request.auth.uid, request.resource.data.toId)\n        && recipientAllowsMessageRequest(request.resource.data.toId, request.resource.data.fromId)\n        && (request.resource.data.status == 'pending'`);
}
await writeFile(rulesPath, rules);
