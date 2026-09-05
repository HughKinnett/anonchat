import fs from "node:fs";

const path = "firestore.rules";
let rules = fs.readFileSync(path, "utf8");

const replaceOnce = (needle, replacement, label) => {
  if (!rules.includes(needle)) throw new Error(`Could not locate ${label}`);
  rules = rules.replace(needle, () => replacement);
};

const replaceBetween = (startNeedle, endNeedle, replacement, label) => {
  const start = rules.indexOf(startNeedle);
  const end = rules.indexOf(endNeedle, start);
  if (start < 0 || end < 0) throw new Error(`Could not locate ${label}`);
  rules = rules.slice(0, start) + replacement + rules.slice(end);
};

replaceBetween(
  "    function validOriginalPost() {",
  "    match /siteSettings/{settingId} {",
  `    function validPhaseBMediaItem(item) {
      return item is map
        && item.keys().hasOnly(['type', 'url'])
        && item.type in ['image', 'gif']
        && item.url is string
        && item.url.size() > 0
        && item.url.size() <= 160000;
    }

    function validPhaseBImage(item) {
      return validPhaseBMediaItem(item) && item.type == 'image';
    }

    function validPhaseBMedia(media) {
      return media is list
        && media.size() <= 4
        && (media.size() == 0
          || (media.size() == 1 && validPhaseBMediaItem(media[0]))
          || (media.size() == 2 && validPhaseBImage(media[0]) && validPhaseBImage(media[1]))
          || (media.size() == 3 && validPhaseBImage(media[0]) && validPhaseBImage(media[1])
            && validPhaseBImage(media[2]))
          || (media.size() == 4 && validPhaseBImage(media[0]) && validPhaseBImage(media[1])
            && validPhaseBImage(media[2]) && validPhaseBImage(media[3])));
    }

    function validPhaseBTopics(topics) {
      return topics is list && topics.size() <= 20;
    }

    function validPhaseBPostEdit() {
      return activeUserAfter()
        && resource.data.authorId == request.auth.uid
        && resource.data.get('type', 'original') != 'repost'
        && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['content', 'topics', 'editedAt', 'editVersion'])
        && request.resource.data.content is string
        && (request.resource.data.content.size() <= 500
          || (isPremiumUidAfter(request.auth.uid) && request.resource.data.content.size() <= 20000))
        && (request.resource.data.content.size() >= 1
          || request.resource.data.get('imageData', '').size() > 0
          || request.resource.data.get('media', []).size() > 0)
        && validPhaseBTopics(request.resource.data.get('topics', []))
        && request.resource.data.editedAt == request.time
        && request.resource.data.editVersion is int
        && request.resource.data.editVersion == resource.data.get('editVersion', 0) + 1;
    }

    function validPhaseBCommentEdit() {
      return activeUserAfter()
        && resource.data.uid == request.auth.uid
        && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['text', 'editedAt', 'editVersion'])
        && request.resource.data.text is string
        && request.resource.data.text.size() >= 1
        && request.resource.data.text.size() <= 280
        && request.resource.data.editedAt == request.time
        && request.resource.data.editVersion is int
        && request.resource.data.editVersion == resource.data.get('editVersion', 0) + 1;
    }

    function phaseBEditParentOwned(documentPath) {
      let parent = get(/databases/$(database)/documents/$(documentPath)).data;
      return signedIn()
        && ((parent.keys().hasAny(['authorId']) && parent.authorId == request.auth.uid)
          || (parent.keys().hasAny(['uid']) && parent.uid == request.auth.uid));
    }

    function validPhaseBEditHistoryCreate(documentPath) {
      let before = get(/databases/$(database)/documents/$(documentPath)).data;
      let after = getAfter(/databases/$(database)/documents/$(documentPath)).data;
      return activeUserAfter()
        && phaseBEditParentOwned(documentPath)
        && request.resource.data.keys().hasOnly(['content', 'editVersion', 'editorUid', 'archivedAt'])
        && request.resource.data.editorUid == request.auth.uid
        && request.resource.data.content is string
        && request.resource.data.content.size() <= 20000
        && request.resource.data.editVersion == before.get('editVersion', 0)
        && request.resource.data.archivedAt == request.time
        && ((before.keys().hasAny(['content']) && request.resource.data.content == before.content)
          || (before.keys().hasAny(['text']) && request.resource.data.content == before.text))
        && after.get('editVersion', 0) == before.get('editVersion', 0) + 1
        && after.editedAt == request.time;
    }

    function validOriginalPost() {
      return request.resource.data.keys().hasOnly([
          'type', 'authorId', 'username', 'content', 'imageData', 'media', 'category',
          'options', 'expiresAt', 'moderationState', 'createdAt', 'topics'
        ])
        && request.resource.data.type == 'original'
        && request.resource.data.authorId == request.auth.uid
        && request.resource.data.username == currentUsername()
        && request.resource.data.content is string
        && (request.resource.data.content.size() <= 500
          || (isPremiumUidAfter(request.auth.uid) && request.resource.data.content.size() <= 20000))
        && (request.resource.data.content.size() >= 1
          || request.resource.data.get('imageData', '').size() > 0
          || request.resource.data.get('media', []).size() > 0)
        && request.resource.data.get('imageData', '').size() <= 160000
        && validPhaseBMedia(request.resource.data.get('media', []))
        && validPhaseBTopics(request.resource.data.get('topics', []))
        && request.resource.data.get('category', 'Post') in ['Post', 'Question', 'Confession', 'Advice', 'Rant', 'Good News', 'Poll']
        && request.resource.data.get('options', []) is list
        && request.resource.data.get('options', []).size() <= 4
        && (request.resource.data.get('category', 'Post') != 'Poll'
          || request.resource.data.get('options', []).size() >= 2)
        && (request.resource.data.get('expiresAt', null) == null
          || (request.resource.data.expiresAt is timestamp && request.resource.data.expiresAt > request.time))
        && request.resource.data.moderationState == 'visible'
        && request.resource.data.createdAt == request.time;
    }

    function validRepost(postId) {
      let original = getAfter(/databases/$(database)/documents/posts/$(request.resource.data.originalPostId));
      return request.resource.data.keys().hasOnly([
          'type', 'authorId', 'username', 'sourceCollection', 'originalPostId',
          'originalAuthorId', 'originalUsername', 'content', 'imageData', 'media',
          'moderationState', 'createdAt', 'topics'
        ])
        && request.resource.data.type == 'repost'
        && request.resource.data.authorId == request.auth.uid
        && request.resource.data.username == currentUsername()
        && request.resource.data.sourceCollection == 'posts'
        && postId == 'repost_' + request.auth.uid + '_' + request.resource.data.originalPostId
        && original.data.type == 'original'
        && original.data.get('moderationState', 'visible') != 'hidden'
        && request.resource.data.originalAuthorId == original.data.authorId
        && request.resource.data.originalUsername == original.data.username
        && accountAvailableAfter(original.data.authorId)
        && request.resource.data.content == original.data.content
        && request.resource.data.get('imageData', '') == original.data.get('imageData', '')
        && validPhaseBMedia(request.resource.data.get('media', []))
        && validPhaseBTopics(request.resource.data.get('topics', []))
        && request.resource.data.moderationState == 'visible'
        && request.resource.data.createdAt == request.time;
    }

`,
  "Phase B post validation helpers"
);

replaceOnce(
  `    match /users/{userId}/badges/{badgeId} {
      allow read: if profileBadgesReadable(userId);
      allow create, update, delete: if isAdmin();
    }
`,
  `    match /users/{userId}/badges/{badgeId} {
      allow read: if profileBadgesReadable(userId);
      allow create, update, delete: if isAdmin();
    }

    match /users/{userId}/saved/{entryId} {
      allow read: if signedIn() && request.auth.uid == userId;
      allow create, update: if activeUserAfter()
        && request.auth.uid == userId
        && request.resource.data.keys().hasOnly(['uid', 'postPath', 'savedAt'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.postPath is string
        && request.resource.data.postPath.matches('^(posts|communityPosts)/[^/]+$')
        && request.resource.data.savedAt == request.time;
      allow delete: if signedIn() && request.auth.uid == userId;
    }

    match /users/{userId}/viewHistory/{entryId} {
      allow read: if signedIn() && request.auth.uid == userId;
      allow create, update: if activeUserAfter()
        && request.auth.uid == userId
        && request.resource.data.keys().hasOnly(['uid', 'postPath', 'viewedAt'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.postPath is string
        && request.resource.data.postPath.matches('^(posts|communityPosts)/[^/]+$')
        && request.resource.data.viewedAt == request.time;
      allow delete: if signedIn() && request.auth.uid == userId;
    }

    match /users/{userId}/recentSearches/{entryId} {
      allow read: if signedIn() && request.auth.uid == userId;
      allow create, update: if activeUserAfter()
        && request.auth.uid == userId
        && request.resource.data.keys().hasOnly(['uid', 'value', 'searchedAt'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.value is string
        && request.resource.data.value.size() >= 1
        && request.resource.data.value.size() <= 200
        && request.resource.data.searchedAt == request.time;
      allow delete: if signedIn() && request.auth.uid == userId;
    }
`,
  "private Phase B user collections"
);

replaceOnce(
  `    match /{documentPath=**}/comments/{commentId} {
      allow read: if signedIn() && visibleContentOrAdmin(documentPath);
      allow create: if activeUserAfter()
        && featureEnabled('commentsEnabled')
        && contentAvailableAfter(documentPath)
        && request.resource.data.keys().hasOnly(['uid', 'username', 'text', 'createdAt'])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.username == currentUsername()
        && request.resource.data.text is string
        && request.resource.data.text.size() >= 1
        && request.resource.data.text.size() <= 280
        && request.resource.data.createdAt == request.time;
      allow update: if false;
      allow delete: if (signedIn() && resource.data.uid == request.auth.uid) || isAdmin();
    }
`,
  `    match /{documentPath=**}/comments/{commentId} {
      allow read: if signedIn() && visibleContentOrAdmin(documentPath);
      allow create: if activeUserAfter()
        && featureEnabled('commentsEnabled')
        && contentAvailableAfter(documentPath)
        && request.resource.data.keys().hasOnly([
          'uid', 'username', 'text', 'parentCommentId', 'threadRootId', 'createdAt'
        ])
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.username == currentUsername()
        && request.resource.data.text is string
        && request.resource.data.text.size() >= 1
        && request.resource.data.text.size() <= 280
        && ((!request.resource.data.keys().hasAny(['parentCommentId', 'threadRootId']))
          || (request.resource.data.keys().hasAll(['parentCommentId', 'threadRootId'])
            && request.resource.data.parentCommentId is string
            && request.resource.data.threadRootId is string
            && request.resource.data.parentCommentId.size() > 0
            && request.resource.data.threadRootId.size() > 0
            && existsAfter(/databases/$(database)/documents/$(documentPath)/comments/$(request.resource.data.parentCommentId))
            && existsAfter(/databases/$(database)/documents/$(documentPath)/comments/$(request.resource.data.threadRootId))
            && !getAfter(/databases/$(database)/documents/$(documentPath)/comments/$(request.resource.data.threadRootId)).data.keys().hasAny(['parentCommentId'])))
        && request.resource.data.createdAt == request.time;
      allow update: if validPhaseBCommentEdit();
      allow delete: if (signedIn() && resource.data.uid == request.auth.uid) || isAdmin();
    }

    match /{documentPath=**}/editHistory/{versionId} {
      allow read: if isAdmin();
      allow create: if validPhaseBEditHistoryCreate(documentPath);
      allow update, delete: if false;
    }
`,
  "Phase B comments and edit history"
);

replaceOnce(
  `      allow update: if validModerationHoldUpdate('communityPost', postId, resource.data.authorId)
        || validAdminMaterialRestore()
        || validInterestCommunityPinUpdate()
        || validGroupPinUpdate();`,
  `      allow update: if validModerationHoldUpdate('communityPost', postId, resource.data.authorId)
        || validAdminMaterialRestore()
        || validInterestCommunityPinUpdate()
        || validGroupPinUpdate()
        || validPhaseBPostEdit();`,
  "community post edit rule"
);

replaceOnce(
  `      allow create: if activeUserAfter() && featureEnabled('postingEnabled')
        && (featureEnabled('uploadsEnabled') || request.resource.data.get('imageData', '') == '')
        && (validOriginalPost() || validRepost(postId));
      allow update: if validModerationHoldUpdate('post', postId, resource.data.authorId)
        || validAdminMaterialRestore();`,
  `      allow create: if activeUserAfter() && featureEnabled('postingEnabled')
        && (featureEnabled('uploadsEnabled')
          || (request.resource.data.get('imageData', '') == ''
            && request.resource.data.get('media', []).size() == 0))
        && (validOriginalPost() || validRepost(postId));
      allow update: if validModerationHoldUpdate('post', postId, resource.data.authorId)
        || validAdminMaterialRestore()
        || validPhaseBPostEdit();`,
  "main post Phase B create/edit rule"
);

fs.writeFileSync(path, rules);
console.log("Phase B Firestore rules patch applied");
