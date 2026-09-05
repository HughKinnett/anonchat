import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../firestore.rules", import.meta.url);
let rules = await readFile(path, "utf8");

const helperAnchor = `    function blockPath(left, right) {`;
const helpers = `    function interestCommunityActiveAfter(communityId) {
      return existsAfter(/databases/$(database)/documents/communities/$(communityId))
        && getAfter(/databases/$(database)/documents/communities/$(communityId)).data.visibility == 'public'
        && getAfter(/databases/$(database)/documents/communities/$(communityId)).data.status == 'active';
    }

    function isInterestCommunityMemberAfter(communityId, uid) {
      return uid is string
        && existsAfter(/databases/$(database)/documents/communities/$(communityId)/members/$(uid))
        && getAfter(/databases/$(database)/documents/communities/$(communityId)/members/$(uid)).data.role
          in ['owner', 'moderator', 'member'];
    }

    function isInterestCommunityOwner(communityId) {
      return signedIn()
        && exists(/databases/$(database)/documents/communities/$(communityId)/members/$(request.auth.uid))
        && get(/databases/$(database)/documents/communities/$(communityId)/members/$(request.auth.uid)).data.role == 'owner';
    }

    function isInterestCommunityModerator(communityId) {
      return signedIn()
        && exists(/databases/$(database)/documents/communities/$(communityId)/members/$(request.auth.uid))
        && get(/databases/$(database)/documents/communities/$(communityId)/members/$(request.auth.uid)).data.role
          in ['owner', 'moderator'];
    }

    function validInterestCommunityPinUpdate() {
      return resource.data.keys().hasAny(['communityId'])
        && isInterestCommunityModerator(resource.data.communityId)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['pinnedAt', 'pinnedBy'])
        && ((request.resource.data.keys().hasAll(['pinnedAt', 'pinnedBy'])
            && request.resource.data.pinnedAt == request.time
            && request.resource.data.pinnedBy == request.auth.uid)
          || !request.resource.data.keys().hasAny(['pinnedAt', 'pinnedBy']));
    }

`;

if (!rules.includes("function isInterestCommunityModerator(communityId)")) {
  if (!rules.includes(helperAnchor)) throw new Error("Could not locate Firestore helper insertion point");
  rules = rules.replace(helperAnchor, () => helpers + helperAnchor);
}

const communityMatchAnchor = `    match /communityPosts/{postId} {`;
const communityBlocks = `    match /communities/{communityId} {
      allow read: if signedIn() && resource.data.visibility == 'public';
      allow create: if activeUserAfter()
        && request.resource.data.keys().hasOnly(['name', 'slug', 'description', 'topic', 'rules', 'ownerId', 'visibility', 'status', 'memberCount', 'createdAt', 'updatedAt'])
        && request.resource.data.name is string
        && request.resource.data.name.size() >= 3
        && request.resource.data.name.size() <= 60
        && request.resource.data.slug is string
        && request.resource.data.slug.matches('^[a-z0-9-]{3,60}$')
        && request.resource.data.description is string
        && request.resource.data.description.size() <= 500
        && request.resource.data.topic is string
        && request.resource.data.topic.size() >= 1
        && request.resource.data.topic.size() <= 60
        && request.resource.data.rules is list
        && request.resource.data.rules.size() <= 10
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.visibility == 'public'
        && request.resource.data.status == 'active'
        && request.resource.data.memberCount == 1
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time
        && existsAfter(/databases/$(database)/documents/communities/$(communityId)/members/$(request.auth.uid))
        && getAfter(/databases/$(database)/documents/communities/$(communityId)/members/$(request.auth.uid)).data.uid == request.auth.uid
        && getAfter(/databases/$(database)/documents/communities/$(communityId)/members/$(request.auth.uid)).data.role == 'owner'
        && getAfter(/databases/$(database)/documents/communities/$(communityId)/members/$(request.auth.uid)).data.joinedAt == request.time;
      allow update: if isInterestCommunityOwner(communityId)
        && request.resource.data.keys().hasOnly(['name', 'slug', 'description', 'topic', 'rules', 'ownerId', 'visibility', 'status', 'memberCount', 'createdAt', 'updatedAt'])
        && request.resource.data.ownerId == resource.data.ownerId
        && request.resource.data.visibility == 'public'
        && request.resource.data.memberCount == resource.data.memberCount
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.status in ['active', 'archived']
        && request.resource.data.name is string
        && request.resource.data.name.size() >= 3
        && request.resource.data.name.size() <= 60
        && request.resource.data.description is string
        && request.resource.data.description.size() <= 500
        && request.resource.data.topic is string
        && request.resource.data.topic.size() >= 1
        && request.resource.data.topic.size() <= 60
        && request.resource.data.rules is list
        && request.resource.data.rules.size() <= 10
        && request.resource.data.updatedAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'description', 'topic', 'rules', 'status', 'updatedAt']);
      allow delete: if false;
    }

    match /communities/{communityId}/members/{userId} {
      allow read: if signedIn();
      allow create: if activeUserAfter()
        && request.resource.data.keys().hasOnly(['uid', 'role', 'joinedAt'])
        && request.resource.data.uid == userId
        && request.resource.data.role in ['owner', 'moderator', 'member']
        && request.resource.data.joinedAt == request.time
        && userId == request.auth.uid
        && ((request.resource.data.role == 'member'
            && interestCommunityActiveAfter(communityId))
          || (request.resource.data.role == 'owner'
            && existsAfter(/databases/$(database)/documents/communities/$(communityId))
            && getAfter(/databases/$(database)/documents/communities/$(communityId)).data.ownerId == request.auth.uid));
      allow update: if activeUserAfter()
        && isInterestCommunityOwner(communityId)
        && resource.data.role != 'owner'
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.joinedAt == resource.data.joinedAt
        && request.resource.data.role in ['moderator', 'member']
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['role']);
      allow delete: if signedIn()
        && userId == request.auth.uid
        && resource.data.role != 'owner';
    }

`;

if (!rules.includes("match /communities/{communityId}")) {
  if (!rules.includes(communityMatchAnchor)) throw new Error("Could not locate Community post rules insertion point");
  rules = rules.replace(communityMatchAnchor, () => communityBlocks + communityMatchAnchor);
}

const communityPostPattern = /    match \/communityPosts\/\{postId\} \{[\s\S]*?\n    \}\n\n    match \/communityVotes\//;
const currentCommunityPostBlock = rules.match(communityPostPattern)?.[0] || "";
if (!currentCommunityPostBlock) throw new Error("Could not locate canonical communityPosts rules block");

if (!currentCommunityPostBlock.includes("request.resource.data.keys().hasAny(['communityId'])")) {
  const replacement = `    match /communityPosts/{postId} {
      allow read: if signedIn() && visibleOrAdmin();
      allow create: if activeUserAfter()
        && featureEnabled('postingEnabled')
        && request.resource.data.keys().hasOnly(['authorId', 'username', 'content', 'category', 'circleId', 'communityId', 'options', 'expiresAt', 'moderationState', 'createdAt'])
        && request.resource.data.authorId == request.auth.uid
        && request.resource.data.username == currentUsername()
        && request.resource.data.content is string
        && request.resource.data.content.size() >= 1
        && (request.resource.data.content.size() <= 500
          || (isPremiumUidAfter(request.auth.uid) && request.resource.data.content.size() <= 20000))
        && request.resource.data.category in ['Question', 'Confession', 'Advice', 'Rant', 'Good News', 'Poll']
        && ((request.resource.data.keys().hasAny(['circleId'])
            && !request.resource.data.keys().hasAny(['communityId'])
            && request.resource.data.circleId is string
            && circleAvailableAfter(request.resource.data.circleId))
          || (request.resource.data.keys().hasAny(['communityId'])
            && !request.resource.data.keys().hasAny(['circleId'])
            && request.resource.data.communityId is string
            && interestCommunityActiveAfter(request.resource.data.communityId)
            && isInterestCommunityMemberAfter(request.resource.data.communityId, request.auth.uid)))
        && request.resource.data.options is list
        && request.resource.data.options.size() <= 4
        && request.resource.data.moderationState == 'visible'
        && request.resource.data.createdAt == request.time;
      allow update: if validModerationHoldUpdate('communityPost', postId, resource.data.authorId)
        || validAdminMaterialRestore()
        || validInterestCommunityPinUpdate();
      allow delete: if isAdmin() || (signedIn() && resource.data.authorId == request.auth.uid);
    }

    match /communityVotes/`;
  rules = rules.replace(communityPostPattern, () => replacement);
}

await writeFile(path, rules);
console.log("Communities Firestore security patch applied");
