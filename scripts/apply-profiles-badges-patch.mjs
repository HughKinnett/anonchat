import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../firestore.rules", import.meta.url);
let rules = await readFile(path, "utf8");

const spotifyClause = `            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spotifyPlaylistUrl'])
              && featureEnabled('spotifyEmbedsEnabled')
              && isPremiumUidAfter(userId)
              && request.resource.data.get('spotifyPlaylistUrl', '') is string
              && request.resource.data.get('spotifyPlaylistUrl', '').size() <= 220
              && (request.resource.data.get('spotifyPlaylistUrl', '') == ''
                || request.resource.data.get('spotifyPlaylistUrl', '')
                  .matches('https://open[.]spotify[.]com/playlist/[A-Za-z0-9]+')))
          ));`;

const spotifyWithBio = `            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['spotifyPlaylistUrl'])
              && featureEnabled('spotifyEmbedsEnabled')
              && isPremiumUidAfter(userId)
              && request.resource.data.get('spotifyPlaylistUrl', '') is string
              && request.resource.data.get('spotifyPlaylistUrl', '').size() <= 220
              && (request.resource.data.get('spotifyPlaylistUrl', '') == ''
                || request.resource.data.get('spotifyPlaylistUrl', '')
                  .matches('https://open[.]spotify[.]com/playlist/[A-Za-z0-9]+')))
            ||
            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['bio'])
              && request.resource.data.get('bio', '') is string
              && request.resource.data.get('bio', '').size() <= 300)
          ));`;

if (!rules.includes("affectedKeys().hasOnly(['bio'])")) {
  if (!rules.includes(spotifyClause)) throw new Error("Could not locate user profile update clause");
  rules = rules.replace(spotifyClause, spotifyWithBio);
}

const userBlockEnd = `      allow delete: if activeUser()
          && request.auth.uid == userId
          && exists(/databases/$(database)/documents/accountDeletionRequests/$(request.auth.uid))
          && !isProtectedAdministrator(resource.data.username);
    }

    match /adminDeletionJobs/{targetUid} {`;

const badgeBlocks = `      allow delete: if activeUser()
          && request.auth.uid == userId
          && exists(/databases/$(database)/documents/accountDeletionRequests/$(request.auth.uid))
          && !isProtectedAdministrator(resource.data.username);
    }

    match /badgeTypes/{badgeId} {
      allow read: if signedIn();
      allow create, update, delete: if isAdmin();
    }

    match /users/{userId}/badges/{badgeId} {
      allow read: if signedIn();
      allow create, update, delete: if isAdmin();
    }

    match /adminDeletionJobs/{targetUid} {`;

if (!rules.includes("match /badgeTypes/{badgeId}")) {
  if (!rules.includes(userBlockEnd)) throw new Error("Could not locate users block end");
  rules = rules.replace(userBlockEnd, badgeBlocks);
}

const basicBadgeBlock = `    match /badgeTypes/{badgeId} {
      allow read: if signedIn();
      allow create, update, delete: if isAdmin();
    }`;

const validatedBadgeBlock = `    match /badgeTypes/{badgeId} {
      allow read: if signedIn();
      allow create: if isAdmin()
        && request.resource.data.keys().hasOnly([
          'name', 'description', 'imageUrl', 'category', 'awardMode',
          'milestoneMetric', 'milestoneThreshold', 'active',
          'createdAt', 'createdBy', 'updatedAt'
        ])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 60
        && request.resource.data.description is string
        && request.resource.data.description.size() > 0
        && request.resource.data.description.size() <= 280
        && request.resource.data.imageUrl is string
        && request.resource.data.imageUrl.size() <= 500
        && (request.resource.data.imageUrl == ''
          || request.resource.data.imageUrl.matches('https://.+'))
        && request.resource.data.category in [
          'early_supporter', 'staff', 'contributor', 'popular_post',
          'community_helper', 'long_time_member', 'premium', 'event',
          'milestone', 'special'
        ]
        && request.resource.data.awardMode in ['automatic', 'manual']
        && request.resource.data.active is bool
        && ((request.resource.data.awardMode == 'manual'
            && request.resource.data.milestoneMetric == null
            && request.resource.data.milestoneThreshold == null)
          || (request.resource.data.awardMode == 'automatic'
            && request.resource.data.milestoneMetric in [
              'posts_created', 'single_post_interactions',
              'total_interactions_received', 'comments_received',
              'comments_or_replies_created', 'followers_count',
              'account_age_days', 'early_member', 'premium_active'
            ]
            && (((request.resource.data.milestoneMetric == 'early_member'
                || request.resource.data.milestoneMetric == 'premium_active')
                && request.resource.data.milestoneThreshold == null)
              || (!(request.resource.data.milestoneMetric in ['early_member', 'premium_active'])
                && request.resource.data.milestoneThreshold is int
                && request.resource.data.milestoneThreshold > 0))))
        && request.resource.data.createdAt == request.time
        && request.resource.data.createdBy == request.auth.uid
        && request.resource.data.updatedAt == request.time;
      allow update: if isAdmin()
        && request.resource.data.keys().hasOnly([
          'name', 'description', 'imageUrl', 'category', 'awardMode',
          'milestoneMetric', 'milestoneThreshold', 'active',
          'createdAt', 'createdBy', 'updatedAt'
        ])
        && request.resource.data.name is string
        && request.resource.data.name.size() > 0
        && request.resource.data.name.size() <= 60
        && request.resource.data.description is string
        && request.resource.data.description.size() > 0
        && request.resource.data.description.size() <= 280
        && request.resource.data.imageUrl is string
        && request.resource.data.imageUrl.size() <= 500
        && (request.resource.data.imageUrl == ''
          || request.resource.data.imageUrl.matches('https://.+'))
        && request.resource.data.category in [
          'early_supporter', 'staff', 'contributor', 'popular_post',
          'community_helper', 'long_time_member', 'premium', 'event',
          'milestone', 'special'
        ]
        && request.resource.data.awardMode in ['automatic', 'manual']
        && request.resource.data.active is bool
        && ((request.resource.data.awardMode == 'manual'
            && request.resource.data.milestoneMetric == null
            && request.resource.data.milestoneThreshold == null)
          || (request.resource.data.awardMode == 'automatic'
            && request.resource.data.milestoneMetric in [
              'posts_created', 'single_post_interactions',
              'total_interactions_received', 'comments_received',
              'comments_or_replies_created', 'followers_count',
              'account_age_days', 'early_member', 'premium_active'
            ]
            && (((request.resource.data.milestoneMetric == 'early_member'
                || request.resource.data.milestoneMetric == 'premium_active')
                && request.resource.data.milestoneThreshold == null)
              || (!(request.resource.data.milestoneMetric in ['early_member', 'premium_active'])
                && request.resource.data.milestoneThreshold is int
                && request.resource.data.milestoneThreshold > 0))))
        && request.resource.data.createdAt == resource.data.createdAt
        && request.resource.data.createdBy == resource.data.createdBy
        && request.resource.data.updatedAt == request.time;
      allow delete: if isAdmin();
    }`;

if (!rules.includes("badge definitions whitelist stored schema keys") && rules.includes(basicBadgeBlock)) {
  rules = rules.replace(basicBadgeBlock, validatedBadgeBlock);
}

await writeFile(path, rules);
console.log("profiles and badges Firestore patch applied");
