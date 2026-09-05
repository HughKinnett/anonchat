import { readFile, writeFile } from "node:fs/promises";

// Applies the approved persistent Groups security additions idempotently.
const path = new URL("../firestore.rules", import.meta.url);
let rules = await readFile(path, "utf8");

const helperAnchor = `    function blockPath(left, right) {`;
const helpers = `    function groupPublicAfter(groupId) {
      return existsAfter(/databases/$(database)/documents/groups/$(groupId))
        && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.visibility == 'public'
        && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.premiumRequired == false
        && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.status == 'active';
    }

    function groupActiveAfter(groupId) {
      return existsAfter(/databases/$(database)/documents/groups/$(groupId))
        && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.status == 'active';
    }

    function isGroupMemberAfter(groupId, uid) {
      return uid is string
        && existsAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(uid))
        && getAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(uid)).data.role
          in ['owner', 'moderator', 'member'];
    }

    function isGroupMember(groupId, uid) {
      return uid is string
        && exists(/databases/$(database)/documents/groups/$(groupId)/members/$(uid))
        && get(/databases/$(database)/documents/groups/$(groupId)/members/$(uid)).data.role
          in ['owner', 'moderator', 'member'];
    }

    function isGroupOwner(groupId) {
      return signedIn()
        && isGroupMember(groupId, request.auth.uid)
        && get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data.role == 'owner';
    }

    function isGroupModerator(groupId) {
      return signedIn()
        && isGroupMember(groupId, request.auth.uid)
        && get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data.role
          in ['owner', 'moderator'];
    }

    function groupPostReadable() {
      return !resource.data.keys().hasAny(['groupId'])
        || (exists(/databases/$(database)/documents/groups/$(resource.data.groupId))
          && get(/databases/$(database)/documents/groups/$(resource.data.groupId)).data.visibility == 'public')
        || isGroupMember(resource.data.groupId, request.auth.uid)
        || isAdmin();
    }

    function validGroupPinUpdate() {
      return resource.data.keys().hasAny(['groupId'])
        && isGroupModerator(resource.data.groupId)
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['pinnedAt', 'pinnedBy'])
        && ((request.resource.data.keys().hasAll(['pinnedAt', 'pinnedBy'])
            && request.resource.data.pinnedAt == request.time
            && request.resource.data.pinnedBy == request.auth.uid)
          || !request.resource.data.keys().hasAny(['pinnedAt', 'pinnedBy']));
    }

    function validGroupMemberCountUpdate(groupId) {
      let delta = request.resource.data.memberCount - resource.data.memberCount;
      return signedIn()
        && request.resource.data.updatedAt == request.time
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['memberCount', 'updatedAt'])
        && ((delta == 1
            && ((!exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid))
                && existsAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)))
              || isGroupModerator(groupId)))
          || (delta == -1 && isGroupModerator(groupId))
          || (delta == -1
            && exists(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid))
            && get(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data.role != 'owner'
            && !existsAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid))));
    }

`;

if (!rules.includes("function isGroupModerator(groupId)")) {
  if (!rules.includes(helperAnchor)) throw new Error("Could not locate Group helper insertion point");
  rules = rules.replace(helperAnchor, () => helpers + helperAnchor);
}

const groupMatchAnchor = `    match /communities/{communityId} {`;
const groupBlocks = `    match /groups/{groupId} {
      allow read: if signedIn()
        && (resource.data.visibility == 'public' || isGroupMember(groupId, request.auth.uid) || isAdmin());
      allow create: if activeUserAfter()
        && request.resource.data.keys().hasOnly(['name', 'slug', 'description', 'topic', 'ownerId', 'visibility', 'premiumRequired', 'status', 'memberCount', 'createdAt', 'updatedAt'])
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
        && request.resource.data.ownerId == request.auth.uid
        && request.resource.data.visibility in ['public', 'private']
        && ((request.resource.data.visibility == 'public' && request.resource.data.premiumRequired == false)
          || (request.resource.data.visibility == 'private'
            && request.resource.data.premiumRequired == true
            && isPremiumUidAfter(request.auth.uid)))
        && request.resource.data.status == 'active'
        && request.resource.data.memberCount == 1
        && request.resource.data.createdAt == request.time
        && request.resource.data.updatedAt == request.time
        && existsAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid))
        && getAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data.uid == request.auth.uid
        && getAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data.role == 'owner'
        && getAfter(/databases/$(database)/documents/groups/$(groupId)/members/$(request.auth.uid)).data.joinedAt == request.time;
      allow update: if (isGroupOwner(groupId)
          && request.resource.data.keys().hasOnly(['name', 'slug', 'description', 'topic', 'ownerId', 'visibility', 'premiumRequired', 'status', 'memberCount', 'createdAt', 'updatedAt'])
          && request.resource.data.ownerId == resource.data.ownerId
          && request.resource.data.visibility == resource.data.visibility
          && request.resource.data.premiumRequired == resource.data.premiumRequired
          && request.resource.data.memberCount == resource.data.memberCount
          && request.resource.data.createdAt == resource.data.createdAt
          && request.resource.data.status in ['active', 'archived']
          && request.resource.data.updatedAt == request.time
          && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name', 'description', 'topic', 'status', 'updatedAt']))
        || validGroupMemberCountUpdate(groupId);
      allow delete: if false;
    }

    match /groups/{groupId}/members/{userId} {
      allow read: if signedIn()
        && (get(/databases/$(database)/documents/groups/$(groupId)).data.visibility == 'public'
          || isGroupMember(groupId, request.auth.uid)
          || isAdmin());
      allow create: if activeUserAfter()
        && request.resource.data.keys().hasOnly(['uid', 'role', 'joinedAt', 'invitedBy'])
        && request.resource.data.uid == userId
        && request.resource.data.role in ['owner', 'moderator', 'member']
        && request.resource.data.joinedAt == request.time
        && ((userId == request.auth.uid
            && request.resource.data.role == 'owner'
            && existsAfter(/databases/$(database)/documents/groups/$(groupId))
            && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.ownerId == request.auth.uid)
          || (userId == request.auth.uid
            && request.resource.data.role == 'member'
            && groupPublicAfter(groupId)
            && !request.resource.data.keys().hasAny(['invitedBy']))
          || (userId != request.auth.uid
            && request.resource.data.role == 'member'
            && groupActiveAfter(groupId)
            && getAfter(/databases/$(database)/documents/groups/$(groupId)).data.visibility == 'private'
            && isGroupModerator(groupId)
            && request.resource.data.invitedBy == request.auth.uid));
      allow update: if activeUserAfter()
        && isGroupOwner(groupId)
        && resource.data.role != 'owner'
        && request.resource.data.uid == resource.data.uid
        && request.resource.data.joinedAt == resource.data.joinedAt
        && request.resource.data.get('invitedBy', '') == resource.data.get('invitedBy', '')
        && request.resource.data.role in ['moderator', 'member']
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['role']);
      allow delete: if signedIn()
        && resource.data.role != 'owner'
        && ((userId == request.auth.uid)
          || (isGroupOwner(groupId))
          || (isGroupModerator(groupId) && resource.data.role == 'member'));
    }

`;

if (!rules.includes("match /groups/{groupId}")) {
  if (!rules.includes(groupMatchAnchor)) throw new Error("Could not locate Group rules insertion point");
  rules = rules.replace(groupMatchAnchor, () => groupBlocks + groupMatchAnchor);
}

const communityPostPattern = /    match \/communityPosts\/\{postId\} \{[\s\S]*?\n    \}\n\n    match \/communityVotes\//;
const currentCommunityPostBlock = rules.match(communityPostPattern)?.[0] || "";
if (!currentCommunityPostBlock) throw new Error("Could not locate canonical communityPosts rules block");

if (!currentCommunityPostBlock.includes("request.resource.data.keys().hasAny(['groupId'])")) {
  const replacement = `    match /communityPosts/{postId} {
      allow read: if signedIn() && visibleOrAdmin() && groupPostReadable();
      allow create: if activeUserAfter()
        && featureEnabled('postingEnabled')
        && request.resource.data.keys().hasOnly(['authorId', 'username', 'content', 'category', 'circleId', 'communityId', 'groupId', 'options', 'expiresAt', 'moderationState', 'createdAt'])
        && request.resource.data.authorId == request.auth.uid
        && request.resource.data.username == currentUsername()
        && request.resource.data.content is string
        && request.resource.data.content.size() >= 1
        && (request.resource.data.content.size() <= 500
          || (isPremiumUidAfter(request.auth.uid) && request.resource.data.content.size() <= 20000))
        && request.resource.data.category in ['Question', 'Confession', 'Advice', 'Rant', 'Good News', 'Poll']
        && ((request.resource.data.keys().hasAny(['circleId'])
            && !request.resource.data.keys().hasAny(['communityId', 'groupId'])
            && request.resource.data.circleId is string
            && circleAvailableAfter(request.resource.data.circleId))
          || (request.resource.data.keys().hasAny(['communityId'])
            && !request.resource.data.keys().hasAny(['circleId', 'groupId'])
            && request.resource.data.communityId is string
            && interestCommunityActiveAfter(request.resource.data.communityId)
            && isInterestCommunityMemberAfter(request.resource.data.communityId, request.auth.uid))
          || (request.resource.data.keys().hasAny(['groupId'])
            && !request.resource.data.keys().hasAny(['circleId', 'communityId'])
            && request.resource.data.groupId is string
            && groupActiveAfter(request.resource.data.groupId)
            && isGroupMemberAfter(request.resource.data.groupId, request.auth.uid)))
        && request.resource.data.options is list
        && request.resource.data.options.size() <= 4
        && request.resource.data.moderationState == 'visible'
        && request.resource.data.createdAt == request.time;
      allow update: if validModerationHoldUpdate('communityPost', postId, resource.data.authorId)
        || validAdminMaterialRestore()
        || validInterestCommunityPinUpdate()
        || validGroupPinUpdate();
      allow delete: if isAdmin() || (signedIn() && resource.data.authorId == request.auth.uid);
    }

    match /communityVotes/`;
  rules = rules.replace(communityPostPattern, () => replacement);
}

await writeFile(path, rules);
console.log("Groups Firestore security patch applied");
