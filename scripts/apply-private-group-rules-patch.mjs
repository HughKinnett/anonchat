import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../firestore.rules", import.meta.url);
let rules = await readFile(path, "utf8");

const groupPattern = /    match \/groups\/\{groupId\} \{[\s\S]*?\n    \}\n\n    match \/groups\/\{groupId\}\/members\/\{userId\} \{/;
const groupMatch = rules.match(groupPattern)?.[0] || "";
if (!groupMatch) throw new Error("Could not locate Group rules block");

let nextGroupMatch = groupMatch;
nextGroupMatch = nextGroupMatch.replace(
  "['name', 'slug', 'description', 'topic', 'ownerId', 'visibility', 'premiumRequired', 'status', 'memberCount', 'createdAt', 'updatedAt']",
  "['name', 'slug', 'description', 'topic', 'ownerId', 'visibility', 'premiumRequired', 'encrypted', 'cipherVersion', 'status', 'memberCount', 'createdAt', 'updatedAt']"
);
nextGroupMatch = nextGroupMatch.replace(
  "['name', 'slug', 'description', 'topic', 'ownerId', 'visibility', 'premiumRequired', 'status', 'memberCount', 'createdAt', 'updatedAt']",
  "['name', 'slug', 'description', 'topic', 'ownerId', 'visibility', 'premiumRequired', 'encrypted', 'cipherVersion', 'status', 'memberCount', 'createdAt', 'updatedAt']"
);
nextGroupMatch = nextGroupMatch.replace(
  `        && ((request.resource.data.visibility == 'public' && request.resource.data.premiumRequired == false)\n          || (request.resource.data.visibility == 'private'\n            && request.resource.data.premiumRequired == true\n            && isPremiumUidAfter(request.auth.uid)))`,
  `        && ((request.resource.data.visibility == 'public'\n            && request.resource.data.premiumRequired == false\n            && !request.resource.data.keys().hasAny(['encrypted', 'cipherVersion']))\n          || (request.resource.data.visibility == 'private'\n            && request.resource.data.premiumRequired == true\n            && request.resource.data.encrypted == true\n            && request.resource.data.cipherVersion == 1\n            && isPremiumUidAfter(request.auth.uid)))`
);
nextGroupMatch = nextGroupMatch.replace(
  `          && request.resource.data.premiumRequired == resource.data.premiumRequired\n          && request.resource.data.memberCount == resource.data.memberCount`,
  `          && request.resource.data.premiumRequired == resource.data.premiumRequired\n          && request.resource.data.get('encrypted', false) == resource.data.get('encrypted', false)\n          && request.resource.data.get('cipherVersion', 0) == resource.data.get('cipherVersion', 0)\n          && request.resource.data.memberCount == resource.data.memberCount`
);
if (nextGroupMatch !== groupMatch) rules = rules.replace(groupPattern, () => nextGroupMatch);

const messageAnchor = `    match /communities/{communityId} {`;
const privateMessageBlock = `    match /groups/{groupId}/privateGroupMessages/{messageId} {
      allow read: if activeUser() && isGroupMember(groupId, request.auth.uid);
      allow create: if activeUserAfter()
        && isGroupMemberAfter(groupId, request.auth.uid)
        && existsAfter(/databases/$(database)/documents/groups/$(groupId))
        && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.visibility == 'private'
        && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.premiumRequired == true
        && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.encrypted == true
        && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.status == 'active'
        && request.resource.data.keys().hasOnly(['senderId', 'encrypted', 'cipherVersion', 'bodyCipher', 'createdAt'])
        && request.resource.data.senderId == request.auth.uid
        && request.resource.data.encrypted == true
        && request.resource.data.cipherVersion == 1
        && request.resource.data.bodyCipher is map
        && request.resource.data.bodyCipher.keys().hasOnly(['version', 'algorithm', 'iv', 'ciphertext'])
        && request.resource.data.bodyCipher.version == 1
        && request.resource.data.bodyCipher.algorithm == 'A256GCM'
        && request.resource.data.bodyCipher.iv is string
        && request.resource.data.bodyCipher.iv.size() <= 32
        && request.resource.data.bodyCipher.ciphertext is string
        && request.resource.data.bodyCipher.ciphertext.size() <= 12000
        && request.resource.data.createdAt == request.time;
      allow update: if false;
      allow delete: if signedIn()
        && isGroupMember(groupId, request.auth.uid)
        && (resource.data.senderId == request.auth.uid || isGroupModerator(groupId));
    }

`;

if (!rules.includes("match /groups/{groupId}/privateGroupMessages/{messageId}")) {
  if (!rules.includes(messageAnchor)) throw new Error("Could not locate private Group message insertion point");
  rules = rules.replace(messageAnchor, () => privateMessageBlock + messageAnchor);
}

const oldRead = `      allow read: if activeUser() && (resource.data.recipientUid == request.auth.uid\n        || (resource.data.kind == 'temporary' && temporaryRoomMember(resource.data.roomId, request.auth.uid))\n        || (resource.data.kind == 'premium' && premiumRoomMember(resource.data.roomId, request.auth.uid)));`;
const newRead = `      allow read: if activeUser() && (resource.data.recipientUid == request.auth.uid\n        || (resource.data.kind == 'temporary' && temporaryRoomMember(resource.data.roomId, request.auth.uid))\n        || (resource.data.kind == 'premium' && premiumRoomMember(resource.data.roomId, request.auth.uid))\n        || (resource.data.kind == 'privateGroup' && isGroupMember(resource.data.roomId, request.auth.uid)));`;
if (rules.includes(oldRead)) rules = rules.replace(oldRead, newRead);

rules = rules.replace(
  "request.resource.data.kind in ['temporary', 'premium']",
  "request.resource.data.kind in ['temporary', 'premium', 'privateGroup']"
);

const oldCreateTail = `          || (request.resource.data.kind == 'premium'\n            && premiumRoomMemberAfter(request.resource.data.roomId, request.auth.uid)\n            && premiumRoomMemberAfter(request.resource.data.roomId, request.resource.data.recipientUid)))`;
const newCreateTail = `          || (request.resource.data.kind == 'premium'\n            && premiumRoomMemberAfter(request.resource.data.roomId, request.auth.uid)\n            && premiumRoomMemberAfter(request.resource.data.roomId, request.resource.data.recipientUid))\n          || (request.resource.data.kind == 'privateGroup'\n            && isGroupMemberAfter(request.resource.data.roomId, request.auth.uid)\n            && isGroupMemberAfter(request.resource.data.roomId, request.resource.data.recipientUid)\n            && getAfter(/databases/$(database)/documents/groups/$(request.resource.data.roomId)).data.visibility == 'private'\n            && getAfter(/databases/$(database)/documents/groups/$(request.resource.data.roomId)).data.encrypted == true))`;
if (rules.includes(oldCreateTail)) rules = rules.replace(oldCreateTail, newCreateTail);

const oldDelete = `      allow delete: if signedIn() && resource.data.recipientUid == request.auth.uid;`;
const newDelete = `      allow delete: if signedIn()\n        && (resource.data.recipientUid == request.auth.uid\n          || (resource.data.kind == 'privateGroup' && isGroupModerator(resource.data.roomId)));`;
if (rules.includes(oldDelete)) rules = rules.replace(oldDelete, newDelete);

await writeFile(path, rules);
console.log("Private Group Firestore security patch applied");
