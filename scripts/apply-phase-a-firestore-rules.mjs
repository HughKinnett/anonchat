import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../firestore.rules", import.meta.url);
let rules = await readFile(path, "utf8");

const helperAnchor = `    function activeUser() {`;
const helpers = `    function validProfilePrivacyUpdate(userId) {
      let privacy = request.resource.data.profilePrivacy;
      return request.auth.uid == userId
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['profilePrivacy'])
        && privacy is map
        && privacy.keys().hasOnly(['showPosts', 'showBadges', 'showFollowersFollowing', 'showActivity'])
        && privacy.keys().hasAll(['showPosts', 'showBadges', 'showFollowersFollowing', 'showActivity'])
        && privacy.showPosts is bool
        && privacy.showBadges is bool
        && privacy.showFollowersFollowing is bool
        && privacy.showActivity is bool;
    }

    function validProfilePinUpdate(userId) {
      let pinnedPostId = request.resource.data.get('pinnedPostId', null);
      return request.auth.uid == userId
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['pinnedPostId'])
        && (pinnedPostId == null
          || (pinnedPostId is string
            && pinnedPostId.size() > 0
            && pinnedPostId.size() <= 160
            && ((existsAfter(/databases/$(database)/documents/posts/$(request.resource.data.pinnedPostId))
                && getAfter(/databases/$(database)/documents/posts/$(request.resource.data.pinnedPostId)).data.authorId == userId
                && getAfter(/databases/$(database)/documents/posts/$(request.resource.data.pinnedPostId)).data.get('moderationState', 'visible') != 'hidden')
              || (existsAfter(/databases/$(database)/documents/communityPosts/$(request.resource.data.pinnedPostId))
                && getAfter(/databases/$(database)/documents/communityPosts/$(request.resource.data.pinnedPostId)).data.authorId == userId
                && getAfter(/databases/$(database)/documents/communityPosts/$(request.resource.data.pinnedPostId)).data.get('moderationState', 'visible') != 'hidden'))));
    }

`;

if (!rules.includes("function validProfilePrivacyUpdate(userId)")) {
  if (!rules.includes(helperAnchor)) throw new Error("Could not find activeUser helper anchor");
  rules = rules.replace(helperAnchor, helpers + helperAnchor);
}

const badgeHelper = `    function profileBadgesReadable(userId) {
      let profilePath = /databases/$(database)/documents/users/$(userId);
      return signedIn()
        && exists(profilePath)
        && (request.auth.uid == userId
          || isAdmin()
          || get(profilePath).data.get('profilePrivacy', {}).get('showBadges', true) == true);
    }

`;
if (!rules.includes("function profileBadgesReadable(userId)")) {
  if (!rules.includes(helperAnchor)) throw new Error("Could not find badge privacy helper anchor");
  rules = rules.replace(helperAnchor, badgeHelper + helperAnchor);
}

const updateAnchor = `            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['bio'])
              && request.resource.data.get('bio', '') is string
              && request.resource.data.get('bio', '').size() <= 300)`;
const updateReplacement = `            validProfilePrivacyUpdate(userId)
            ||
            validProfilePinUpdate(userId)
            ||
            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['bio'])
              && request.resource.data.get('bio', '') is string
              && request.resource.data.get('bio', '').size() <= 300)`;

if (!rules.includes("validProfilePrivacyUpdate(userId)\n            ||\n            validProfilePinUpdate(userId)")) {
  if (!rules.includes(updateAnchor)) throw new Error("Could not find user update anchor");
  rules = rules.replace(updateAnchor, updateReplacement);
}

const badgeReadAnchor = `    match /users/{userId}/badges/{badgeId} {
      allow read: if signedIn();
      allow create, update, delete: if isAdmin();
    }`;
const badgeReadReplacement = `    match /users/{userId}/badges/{badgeId} {
      allow read: if profileBadgesReadable(userId);
      allow create, update, delete: if isAdmin();
    }`;
if (rules.includes(badgeReadAnchor)) rules = rules.replace(badgeReadAnchor, badgeReadReplacement);

await writeFile(path, rules);
console.log("Phase A Firestore rules patch applied");
